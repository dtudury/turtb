/* eslint-env browser */
import { Stream } from '../../stream/Stream.js'
import { hx } from '../../stream/hx.js'
import { mount } from '../../stream/mount.js'
import './components/counter.js'
import './components/toggle.js'
import './components/text-input.js'
import './components/accordion.js'
import './components/sign-in.js'
import './components/status-badge.js'
import { createToaster } from './components/toast.js'

const stream = new Stream()

const state = await fetch('/apps/components/state.json').then(r => r.json())
stream.set(state)

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

// Pre-populate stream name from server if available
try {
  const info = await fetch('/api/info').then(r => r.json())
  if (info.name) signIn.streamName = info.name
} catch { /* server not available, use default */ }

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
for (const [key, val] of Object.entries(state)) {
  for (const [field, v] of Object.entries(val)) {
    console.log(`  stream.set('${key}', '${field}', ${JSON.stringify(v)})`)
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
