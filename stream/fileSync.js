import { subscribe } from '@parcel/watcher'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { dirname, join, relative } from 'path'
import { compile } from '@gerhobbelt/gitignore-parser'

const ALWAYS_IGNORE = '.env\n.DS_Store\n.git\nnode_modules'

/**
 * Build a filter function from the folder's .gitignore plus hard-coded ignores.
 * @param {string} folder
 * @param {string} dataDir  the archive dir, always excluded
 * @returns {(rel: string) => boolean}
 */
function buildFilter (folder, dataDir) {
  let content = ALWAYS_IGNORE
  try { content = readFileSync(join(folder, '.gitignore'), 'utf8') + '\n' + content } catch {}
  const gitignore = compile(content)
  const dataDirRel = relative(folder, dataDir)
  return rel => !rel.startsWith(dataDirRel + '/') && rel !== dataDirRel && gitignore.accepts(rel)
}

/**
 * Decode file bytes: UTF-8 text → string, binary → Uint8Array.
 * @param {Buffer} bytes
 * @returns {string|Uint8Array}
 */
function decodeBytes (bytes) {
  if (bytes.includes(0)) return new Uint8Array(bytes)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return new Uint8Array(bytes) }
}

/**
 * Recursively read all accepted files in folder.
 * @param {string} folder
 * @param {(rel: string) => boolean} accepts
 * @returns {Promise<Object>}
 */
async function readFolder (folder, accepts) {
  const files = {}
  let maxMtime = 0
  const walk = async dir => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(folder, abs)
      if (!accepts(rel)) continue
      if (entry.isDirectory()) await walk(abs)
      else if (entry.isFile()) {
        const [bytes, info] = await Promise.all([readFile(abs), stat(abs)])
        files[rel] = decodeBytes(bytes)
        if (info.mtimeMs > maxMtime) maxMtime = info.mtimeMs
      }
    }
  }
  await walk(folder)
  return { files, maxMtime }
}

/**
 * Write a files object to folder, creating directories as needed.
 * @param {string} folder
 * @param {Object} files
 */
async function writeToFolder (folder, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(folder, rel)
    await mkdir(dirname(abs), { recursive: true })
    if (typeof content !== 'string' && !(content instanceof Uint8Array)) continue
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    await writeFile(abs, bytes)
  }
}

/**
 * Delete files from folder.
 * @param {string} folder
 * @param {string[]} rels
 */
async function deleteFromFolder (folder, rels) {
  for (const rel of rels) {
    try { await unlink(join(folder, rel)) } catch {}
  }
}

/**
 * Rough equality check for a files object (handles Uint8Array values).
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
function filesEqual (a, b) {
  if (!a || !b) return a === b
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) return false
  for (const k of aKeys) {
    const av = a[k]
    const bv = b[k]
    if (av instanceof Uint8Array && bv instanceof Uint8Array) {
      if (av.length !== bv.length) return false
      if (!av.every((byte, i) => byte === bv[i])) return false
    } else if (av !== bv) return false
  }
  return true
}

/**
 * Two-way sync between a folder and a Stream.
 *
 * Initial state:
 *   - Stream has data  → stream wins, writes to folder
 *   - Stream is empty  → folder wins, sets stream
 *
 * Ongoing:
 *   - Folder changes   → reads folder, updates stream if content differs
 *   - Stream changes   → writes changed files to folder, deletes removed files
 *
 * @param {import('./Stream.js').Stream} stream
 * @param {string} [folder='.']
 * @param {string} [dataDir='.stream']
 * @param {string|null} [archivePath=null]  path to the archive file, used for timestamp comparison
 * @returns {Promise<import('@parcel/watcher').AsyncSubscription>}
 */
export async function fileSync (stream, folder = '.', dataDir = '.stream', archivePath = null) {
  const accepts = buildFilter(folder, dataDir)

  let archiveMtime = 0
  if (archivePath) {
    try { archiveMtime = (await stat(archivePath)).mtimeMs } catch {}
  }

  const { files: diskFiles, maxMtime: diskMtime } = await readFolder(folder, accepts)
  const streamValue = stream.byteLength > 0 ? stream.get() : null
  const streamFiles = streamValue && typeof streamValue === 'object' && !Array.isArray(streamValue) && !(streamValue instanceof Uint8Array)
    ? streamValue
    : null

  const diskIsNewer = diskMtime > archiveMtime

  // Resolve initial state
  if (streamFiles && !diskIsNewer) {
    // Stream wins: write stream content to disk
    const toDelete = Object.keys(diskFiles).filter(k => !(k in streamFiles))
    await writeToFolder(folder, streamFiles)
    await deleteFromFolder(folder, toDelete)
  } else if (Object.keys(diskFiles).length > 0) {
    // Disk wins: push disk content into stream
    stream.set(diskFiles)
  }

  // Mutex: prevents a change in one direction from echoing back through the other
  let updating = false
  const withLock = async fn => {
    if (updating) return
    updating = true
    try { await fn() } finally { updating = false }
  }

  // Stream → disk
  stream.watch('fileSync:stream→disk', () => {
    if (updating) return
    const files = stream.get()
    if (!files || typeof files !== 'object' || Array.isArray(files)) return
    withLock(async () => {
      const current = await readFolder(folder, accepts)
      if (filesEqual(current, files)) return
      const toDelete = Object.keys(current).filter(k => !(k in files))
      await writeToFolder(folder, files)
      await deleteFromFolder(folder, toDelete)
    })
  })

  // Disk → stream
  const subscription = await subscribe(folder, (err, events) => {
    if (err) { console.error('fileSync watcher error:', err); return }
    const relevant = events.filter(e => accepts(relative(folder, e.path)))
    if (!relevant.length) return
    withLock(async () => {
      const newFiles = await readFolder(folder, accepts)
      const current = stream.byteLength > 0 ? stream.get() : {}
      if (!filesEqual(current, newFiles)) stream.set(newFiles)
    })
  })

  return subscription
}
