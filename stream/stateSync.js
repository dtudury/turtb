import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync, realpathSync } from 'fs'
import { dirname, join, basename } from 'path'
import { subscribe } from '@parcel/watcher'

/**
 * Bidirectional sync between a plain Stream and a JSON file.
 *
 * On startup:
 *   - If the stream is empty and the file exists, loads the file into the stream.
 *   - If the stream already has data, writes it to the file immediately.
 *
 * While running:
 *   - Stream changes → file is rewritten with the current JSON value.
 *   - File changes (external editor, etc.) → stream is updated via set().
 *
 * A simple flag prevents echo loops (stream→file write triggering file→stream).
 *
 * Only works with plain Stream (not Repository subclasses).
 *
 * @param {import('./Stream.js').Stream} stream
 * @param {string} filePath  path to the JSON state file
 */
export async function stateSync (stream, filePath) {
  await mkdir(dirname(filePath), { recursive: true })

  let writing = false

  const writeState = async () => {
    const value = stream.get()
    if (value === undefined) return
    writing = true
    try {
      await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8')
    } finally {
      writing = false
    }
  }

  const readState = async () => {
    try {
      const text = await readFile(filePath, 'utf8')
      const value = JSON.parse(text)
      stream.set(value)
    } catch { /* file missing or invalid JSON — ignore */ }
  }

  // Bootstrap: load file into stream if stream is empty, otherwise write stream to file
  if (stream.byteLength === 0) {
    if (existsSync(filePath)) await readState()
  } else {
    await writeState()
  }

  // Stream → file
  stream.watch('stateSync:stream→file', () => {
    stream.recaller.reportKeyAccess(stream, 'length')
    writeState().catch(console.error)
  })

  // File → stream: resolve symlinks so event paths match on macOS (/tmp → /private/tmp)
  const dir = dirname(filePath)
  let realDir
  try { realDir = realpathSync(dir) } catch { realDir = dir }
  const realFilePath = join(realDir, basename(filePath))
  await subscribe(realDir, (err, events) => {
    if (err || writing) return
    if (!events.some(e => e.path === realFilePath)) return
    readState().catch(console.error)
  })
}
