/* eslint-env browser */
import { Repository } from '../../stream/Repository.js'
import { turtle } from '../../stream/turtle.js'
import { mount } from '../../stream/mount.js'

// ── Bootstrap ────────────────────────────────────────────────────────────

const statusEl = document.getElementById('status')
const keyEl = document.getElementById('key-display')
const root = document.getElementById('root')

function setStatus (connected) {
  statusEl.textContent = connected ? 'connected' : 'disconnected'
  statusEl.className = 'pill ' + (connected ? 'ok' : 'err')
}

const info = await fetch('/api/info').then(r => r.json())
const { primaryKeyHex } = info
keyEl.textContent = primaryKeyHex

// ── Stream setup ─────────────────────────────────────────────────────────

const stream = new Repository()

function connectWS () {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://${location.host}`)
  ws.binaryType = 'arraybuffer'
  ws.addEventListener('open', () => { ws.send(primaryKeyHex); setStatus(true) })
  ws.addEventListener('close', () => { setStatus(false); setTimeout(connectWS, 2000) })
  ws.addEventListener('error', () => ws.close())
  const writer = stream.makeWritableStream().getWriter()
  ws.addEventListener('message', e => writer.write(new Uint8Array(e.data)).catch(() => {}))
}

connectWS()

// ── UI state ─────────────────────────────────────────────────────────────

// A plain object used as a key for recaller so selectedFile changes trigger re-renders.
const uiState = {}
let selectedFile = null
let editContent = ''   // snapshot at selection time — not reactive to stream updates

function selectFile (path) {
  selectedFile = path
  const files = getFiles()
  const content = files?.[path]
  editContent = typeof content === 'string' ? content : ''
  stream.recaller.reportKeyMutation(uiState, 'selected')
}

// ── Data helpers ─────────────────────────────────────────────────────────

function getFiles () {
  const commit = stream.lastCommit
  if (!commit) return null
  return stream.decode(commit.dataAddress)
}

async function saveFile () {
  if (!selectedFile) return
  const ta = document.querySelector('.editor-textarea')
  if (!ta) return
  await fetch('/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: selectedFile, content: ta.value })
  })
}

// ── Browser console globals ──────────────────────────────────────────────

Object.assign(window, { stream, turtle, mount, primaryKeyHex, getFiles, selectFile, saveFile })

// ── Rendering ────────────────────────────────────────────────────────────

mount(turtle`
  <div class="workspace">
    <div class="file-list">
      ${() => {
        stream.recaller.reportKeyAccess(uiState, 'selected')
        const files = getFiles()
        if (!files) return turtle`<div class="empty-hint">no commits yet</div>`
        const paths = Object.keys(files).sort()
        if (!paths.length) return turtle`<div class="empty-hint">no files</div>`
        return paths.map(path => turtle`
          <div class="${'file-item' + (selectedFile === path ? ' selected' : '')}"
               onclick="${() => () => selectFile(path)}">
            <span class="file-path">${path}</span>
            ${files[path] instanceof Uint8Array ? turtle`<span class="dim">bin</span>` : turtle``}
          </div>
        `)
      }}
    </div>
    <div class="${() => {
      stream.recaller.reportKeyAccess(uiState, 'selected')
      return 'editor-panel' + (selectedFile ? '' : ' hidden')
    }}">
      ${() => {
        stream.recaller.reportKeyAccess(uiState, 'selected')
        if (!selectedFile) return turtle`<div class="empty-hint">select a file to edit</div>`
        const files = getFiles()
        const isText = typeof files?.[selectedFile] === 'string'
        return turtle`
          <div class="editor-header">
            <span class="editor-filename">${selectedFile}</span>
            ${isText ? turtle`<button onclick="${() => saveFile}">save</button>` : turtle``}
          </div>
          <textarea class="editor-textarea"
                    value="${isText ? editContent : '[binary file — not editable]'}"
                    readonly="${!isText}"></textarea>
        `
      }}
    </div>
  </div>
`, root, stream.recaller)
