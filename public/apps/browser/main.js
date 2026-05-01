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

// ── Repository setup ─────────────────────────────────────────────────────

const repository = new Repository()

function connectWS () {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://${location.host}`)
  ws.binaryType = 'arraybuffer'
  ws.addEventListener('open', () => { ws.send(primaryKeyHex); setStatus(true) })
  ws.addEventListener('close', () => { setStatus(false); setTimeout(connectWS, 2000) })
  ws.addEventListener('error', () => ws.close())
  const writer = repository.makeWritableStream().getWriter()
  ws.addEventListener('message', e => writer.write(new Uint8Array(e.data)).catch(() => {}))
}

connectWS()

// ── UI state ─────────────────────────────────────────────────────────────

const uiState = {}
let selectedFile = null
let editContent = ''
let viewingCommitAddr = null   // null = latest, number = address of historical commit
let commitMessage = ''

function selectFile (path) {
  selectedFile = path
  const files = getFiles()
  const value = files?.[path]
  if (typeof value === 'string') editContent = value
  else if (value instanceof Uint8Array) editContent = ''
  else if (value != null) editContent = JSON.stringify(value, null, 2)
  else editContent = ''
  repository.recaller.reportKeyMutation(uiState, 'selected')
}

function selectCommit (addr) {
  viewingCommitAddr = addr
  selectedFile = null
  editContent = ''
  repository.recaller.reportKeyMutation(uiState, 'selected')
}

// ── Data helpers ─────────────────────────────────────────────────────────

function getFiles () {
  const commitAddr = viewingCommitAddr !== null ? viewingCommitAddr : null
  const dataAddress = commitAddr !== null
    ? repository.decode(commitAddr)?.dataAddress
    : repository.lastCommit?.dataAddress
  if (dataAddress == null) return null
  return repository.decode(dataAddress)
}

function getHistory () {
  const result = []
  let addr = repository.valueAddress
  while (addr >= 0) {
    const commit = repository.decode(addr)
    if (!commit || typeof commit.message !== 'string') break
    result.push({ commit, addr })
    addr = commit.parent !== undefined ? commit.parent : -1
  }
  return result
}

async function saveFile () {
  if (!selectedFile || viewingCommitAddr !== null) return
  const ta = document.querySelector('.editor-textarea')
  if (!ta) return
  const message = commitMessage.trim() || `edit ${selectedFile}`
  await fetch('/api/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: selectedFile, content: ta.value, message })
  })
  commitMessage = ''
  repository.recaller.reportKeyMutation(uiState, 'commitMessage')
}

// ── Browser console globals ──────────────────────────────────────────────

Object.assign(window, { repository, turtle, mount, primaryKeyHex, getFiles, getHistory, selectFile, selectCommit, saveFile })

// ── Rendering ────────────────────────────────────────────────────────────

mount(turtle`
  <div class="layout">

    <div class="file-panel">
      <div class="file-list">
        ${() => {
          repository.recaller.reportKeyAccess(uiState, 'selected')
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

      <div class="history-panel">
        <div class="history-label">history</div>
        ${() => {
          repository.recaller.reportKeyAccess(uiState, 'selected')
          repository.recaller.reportKeyAccess(repository, 'length')
          const history = getHistory()
          if (!history.length) return turtle`<div class="empty-hint" style="height:4rem">no commits</div>`
          return history.map(({ commit, addr }) => turtle`
            <div class="${'history-item' + (viewingCommitAddr === addr ? ' active' : '')}"
                 onclick="${() => () => selectCommit(viewingCommitAddr === addr ? null : addr)}">
              <span class="history-msg">${commit.message || '(no message)'}</span>
              <span class="dim" style="font-size:0.7rem">${commit.date.toLocaleString()}</span>
            </div>
          `)
        }}
      </div>
    </div>

    <div class="${() => {
      repository.recaller.reportKeyAccess(uiState, 'selected')
      return 'editor-panel' + (selectedFile ? '' : ' hidden')
    }}">
      ${() => {
        repository.recaller.reportKeyAccess(uiState, 'selected')
        if (!selectedFile) return turtle``

        const files = getFiles()
        const value = files?.[selectedFile]
        const isText = typeof value === 'string'
        const isJson = value != null && typeof value === 'object' && !(value instanceof Uint8Array)
        const isEditable = (isText || isJson) && viewingCommitAddr === null

        const viewingCommit = viewingCommitAddr !== null ? repository.decode(viewingCommitAddr) : null

        return turtle`
          ${viewingCommit ? turtle`
            <div class="history-banner">
              <span>viewing "${viewingCommit.message || '(no message)'}" — ${viewingCommit.date.toLocaleString()}</span>
              <button onclick="${() => () => selectCommit(null)}">→ latest</button>
            </div>
          ` : turtle``}
          <div class="editor-header">
            <span class="editor-filename">${selectedFile}</span>
            ${isEditable ? turtle`
              <input class="commit-message-input" placeholder="commit message…"
                     value="${() => {
                       repository.recaller.reportKeyAccess(uiState, 'commitMessage')
                       return commitMessage
                     }}"
                     oninput="${() => e => {
                       commitMessage = e.target.value
                       repository.recaller.reportKeyMutation(uiState, 'commitMessage')
                     }}" />
              <button onclick="${() => saveFile}">save</button>
            ` : turtle``}
          </div>
          <textarea class="editor-textarea"
                    value="${isEditable ? editContent : isJson ? JSON.stringify(value, null, 2) : isText ? value : '[binary file]'}"
                    readonly="${!isEditable}"></textarea>
        `
      }}
    </div>

  </div>
`, root, repository.recaller)
