/* eslint-env browser */
import { Repository } from '../../stream/Repository.js'
import { hx } from '../../stream/hx.js'
import { mount } from '../../stream/mount.js'
import './components/counter.js'
import './components/toggle.js'
import './components/text-input.js'
import './components/accordion.js'
import './components/sign-in.js'
import './components/status-badge.js'
import { createToaster } from './components/toast.js'

const stream = new Repository()

// ── Bootstrap ─────────────────────────────────────────────────────────────
// Load the server's raw stream bytes before connecting via WebSocket.
// This ensures both sides share the same address space — chunks contain
// embedded addresses that are only valid in the stream they were created in.
// Without this, any structural chunk from one peer would reference addresses
// that don't exist on the other, causing decode failures and rejected sigs.

let serverInfo = null
try {
  serverInfo = await fetch('/api/info').then(r => r.json())
  if (serverInfo.primaryKeyHex) {
    const response = await fetch(`/streams/${serverInfo.primaryKeyHex}/raw`)
    if (response.ok) {
      const reader = response.body.getReader()
      const writer = stream.makeWritableStream().getWriter()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        await writer.write(value)
      }
    }
  }
} catch { /* server not available */ }

// Fall back to defaults if the repository has no commits yet (first run or offline)
if (!stream.lastCommit) {
  const defaults = await fetch('/apps/components/state.json').then(r => r.json())
  stream.set(defaults)
}

// ── Shared UI state ───────────────────────────────────────────────────────

// syncState is a plain object tracked by the recaller — not stored in the stream.
// status: null | 'connecting' | 'server-sync' | 'local-only' | 'reconnecting'
const syncState = { status: null, username: null }

const toaster = createToaster(stream.recaller)

// ── Component factory ─────────────────────────────────────────────────────

function makeComponent (tag, key) {
  const el = document.createElement(tag)
  el.stream = stream
  el.key = key
  return el
}

// ── Toast container (body-level, renders outside the app root) ────────────

const toastContainer = document.createElement('hx-toast-container')
toastContainer.toaster = toaster
document.body.appendChild(toastContainer)

// ── Sign-in ───────────────────────────────────────────────────────────────

const signIn = document.createElement('hx-sign-in')
signIn.stream = stream
signIn.cancelable = true
signIn.syncState = syncState
signIn.toaster = toaster

if (serverInfo?.name) signIn.streamName = serverInfo.name
if (serverInfo?.keyIterations) signIn.keyIterations = serverInfo.keyIterations

// ── Status badge ──────────────────────────────────────────────────────────

const statusBadge = document.createElement('hx-status-badge')
statusBadge.syncState = syncState
statusBadge.recaller = stream.recaller

// ── Console helpers ───────────────────────────────────────────────────────

Object.assign(window, { stream, toaster })

console.group('components')
console.log('stream                           — Stream instance')
console.log('stream.get()                     — current state object')
console.log('stream.set(key, field, value)    — update any field')
console.log('toaster.show(message, type)      — trigger a toast (types: success/error/info/warning)')
console.log('')
console.log('examples:')
for (const [key, val] of Object.entries(stream.get() ?? {})) {
  if (val && typeof val === 'object') {
    for (const [field, v] of Object.entries(val)) {
      console.log(`  stream.set('${key}', '${field}', ${JSON.stringify(v)})`)
    }
  }
}
console.groupEnd()

// ── Render ────────────────────────────────────────────────────────────────

mount(hx`
  <div>
    <div class="demo-section">
      <div class="demo-label">sync  ${statusBadge}</div>
      ${signIn}
    </div>
    <div class="demo-section">
      <div class="demo-label">counter</div>
      ${makeComponent('hx-counter', 'counter')}
    </div>
    <div class="demo-section">
      <div class="demo-label">toggle</div>
      ${makeComponent('hx-toggle', 'toggle')}
    </div>
    <div class="demo-section">
      <div class="demo-label">text input</div>
      ${makeComponent('hx-text-input', 'textInput')}
    </div>
    <div class="demo-section">
      <div class="demo-label">accordion</div>
      ${makeComponent('hx-accordion', 'accordion')}
    </div>
  </div>
`, document.getElementById('root'), stream.recaller)
