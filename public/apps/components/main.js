/* eslint-env browser */
import { Repository } from '../../stream/Repository.js'
import { turtle } from '../../stream/turtle.js'
import { mount } from '../../stream/mount.js'
import './components/counter.js'
import './components/toggle.js'
import './components/text-input.js'
import './components/accordion.js'
import './components/sign-in.js'
import './components/status-badge.js'
import { createToaster } from './components/toast.js'

const repository = new Repository()

// ── Bootstrap ─────────────────────────────────────────────────────────────
// Load the server's raw stream bytes before connecting via WebSocket.
// This ensures both sides share the same address space — chunks contain
// embedded addresses that are only valid in the stream they were created in.

let serverInfo = null
try {
  serverInfo = await fetch('/api/info').then(r => r.json())
  if (serverInfo.primaryKeyHex) {
    const response = await fetch(`/streams/${serverInfo.primaryKeyHex}/raw`)
    if (response.ok) {
      const reader = response.body.getReader()
      const writer = repository.makeWritableStream().getWriter()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        await writer.write(value)
      }
    }
  }
} catch { /* server not available */ }

// ── State proxy ───────────────────────────────────────────────────────────
// Component state lives at 'state.json' within the file repository.
// The proxy presents the same get/set API as Stream, without the key prefix.
// With --files, changes here update state.json on disk and vice versa.

const state = {
  get recaller () { return repository.recaller },
  get (...args) { return repository.get('state.json', ...args) },
  set (...args) { return repository.set('state.json', ...args) }
}

// Seed defaults if no state exists (offline / first run without --files)
if (!state.get()) {
  repository.set('state.json', {
    counter: { label: 'count', value: 0 },
    toggle: { label: 'enabled', value: false },
    textInput: { label: 'message', placeholder: 'type something…', value: '' },
    accordion: {
      title: 'about',
      body: 'Each change here is a commit. With --files, state.json on disk stays in sync. Every connected device is an equal author.',
      open: false
    }
  })
}

// ── Shared UI state ───────────────────────────────────────────────────────

const syncState = { status: null, username: null }
const toaster = createToaster(repository.recaller)

// ── Component factory ─────────────────────────────────────────────────────

function makeComponent (tag, key) {
  const el = document.createElement(tag)
  el.stream = state   // state proxy: components read/write via state.json
  el.key = key
  return el
}

// ── Toast container ───────────────────────────────────────────────────────

const toastContainer = document.createElement('turtle-toast-container')
toastContainer.toaster = toaster
document.body.appendChild(toastContainer)

// ── Sign-in ───────────────────────────────────────────────────────────────

const signIn = document.createElement('turtle-sign-in')
signIn.stream = repository   // needs full repository for WebSocket + signing
signIn.cancelable = true
signIn.syncState = syncState
signIn.toaster = toaster

if (serverInfo?.name) signIn.streamName = serverInfo.name
if (serverInfo?.keyIterations) signIn.keyIterations = serverInfo.keyIterations

// ── Status badge ──────────────────────────────────────────────────────────

const statusBadge = document.createElement('turtle-status-badge')
statusBadge.syncState = syncState
statusBadge.recaller = repository.recaller

// ── Console helpers ───────────────────────────────────────────────────────

Object.assign(window, { repository, state, toaster })

console.group('components')
console.log('repository                    — full Repository (commits, files, sync)')
console.log('state                         — proxy into state.json (get/set API)')
console.log('state.get()                   — current component state')
console.log('state.set(key, field, value)  — update a component field')
console.log('repository.lastCommit         — most recent commit record')
console.log('[...repository.history()]     — all commits, newest first')
console.log('repository.getRefs()          — root refs (addresses, not values)')
console.log('repository.getRefs("state.json") — state.json refs')
console.log('toaster.show(msg, type)       — trigger a toast')
console.log('')
console.log('examples:')
for (const [key, val] of Object.entries(state.get() ?? {})) {
  if (val && typeof val === 'object') {
    for (const [field, v] of Object.entries(val)) {
      console.log(`  state.set('${key}', '${field}', ${JSON.stringify(v)})`)
    }
  }
}
console.groupEnd()

// ── Render ────────────────────────────────────────────────────────────────

mount(turtle`
  <div>
    <div class="demo-section">
      <div class="demo-label">sync  ${statusBadge}</div>
      ${signIn}
    </div>
    <div class="demo-section">
      <div class="demo-label">counter</div>
      ${makeComponent('turtle-counter', 'counter')}
    </div>
    <div class="demo-section">
      <div class="demo-label">toggle</div>
      ${makeComponent('turtle-toggle', 'toggle')}
    </div>
    <div class="demo-section">
      <div class="demo-label">text input</div>
      ${makeComponent('turtle-text-input', 'textInput')}
    </div>
    <div class="demo-section">
      <div class="demo-label">accordion</div>
      ${makeComponent('turtle-accordion', 'accordion')}
    </div>
    <div class="demo-section">
      <div class="demo-label">history</div>
      ${() => {
        repository.recaller.reportKeyAccess(repository, 'length')
        const commits = [...repository.history()].slice(0, 8)
        if (!commits.length) return turtle`<span class="dim">no commits yet</span>`
        return commits.map(commit => turtle`
          <div class="commit-row">
            <span class="dim mono">${commit.date.toLocaleTimeString()}</span>
            <span>${commit.message || '(no message)'}</span>
          </div>
        `)
      }}
    </div>
  </div>
`, document.getElementById('root'), repository.recaller)
