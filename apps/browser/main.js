import { Stream } from '/stream/Stream.js'
import { hx, mount } from '/stream/hx.js'

// ── Bootstrap ────────────────────────────────────────────────────────────

const statusEl = document.getElementById('status')
const keyEl = document.getElementById('key-display')
const root = document.getElementById('root')

function setStatus (connected) {
  statusEl.textContent = connected ? 'connected' : 'disconnected'
  statusEl.className = 'pill ' + (connected ? 'ok' : 'err')
}

// Fetch the primary key and stream data from the server
const info = await fetch('/api/info').then(r => r.json())
const { primaryKeyHex } = info

keyEl.textContent = primaryKeyHex

// ── Stream setup ─────────────────────────────────────────────────────────

const stream = new Stream()

function connectWS () {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${protocol}://${location.host}`)

  ws.binaryType = 'arraybuffer'

  ws.addEventListener('open', () => {
    ws.send(primaryKeyHex)
    setStatus(true)
  })

  ws.addEventListener('close', () => {
    setStatus(false)
    setTimeout(connectWS, 2000)
  })

  ws.addEventListener('error', () => ws.close())

  const writer = stream.makeWritableStream().getWriter()

  ws.addEventListener('message', e => {
    writer.write(new Uint8Array(e.data)).catch(() => {})
  })

  return ws
}

connectWS()

// ── Flash on update (CSS animation, re-triggered on each append) ──────────

stream.watch('flash', () => {
  root.classList.remove('flash')
  void root.offsetWidth // force reflow so animation restarts
  root.classList.add('flash')
})

// ── Browser console globals ──────────────────────────────────────────────

const get = (...args) => stream.get(...args)
const set = (...args) => stream.set(...args)
const render = (nodes, el) => mount(nodes, el, stream.recaller)

Object.assign(window, { stream, hx, mount, render, get, set, primaryKeyHex })

console.log(`%cstream browser\n%c  stream           the live Stream instance
  get(...path)     read a value — get('user', 'name')
  set(value)       write a value — set({ hello: 'world' })
  hx\`...\`          build reactive DOM nodes
  render(nodes,el) mount nodes reactively into any element
  primaryKeyHex    this stream's public key`,
  'color: #58a6ff; font-weight: bold',
  'color: #8b949e')

// ── Rendering ────────────────────────────────────────────────────────────

function renderValue (val, depth = 0) {
  if (val === null || val === undefined) return hx`<span class="empty">empty</span>`
  if (typeof val !== 'object') return hx`<span class="entry-val">${String(val)}</span>`
  if (val instanceof Uint8Array) return hx`<span class="entry-val">${'0x' + Array.from(val.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('') + (val.length > 8 ? '…' : '')}</span>`
  if (Array.isArray(val)) {
    return hx`<div style="padding-left: ${depth ? '1rem' : '0'}">${val.map((v, i) => hx`<div class="entry"><span class="entry-key">[${i}]</span>${renderValue(v, depth + 1)}</div>`)}</div>`
  }
  const entries = Object.entries(val)
  if (!entries.length) return hx`<span class="empty">{}</span>`
  return hx`<div style="padding-left: ${depth ? '1rem' : '0'}">${entries.map(([k, v]) => hx`<div class="entry"><span class="entry-key">${k}</span>${renderValue(v, depth + 1)}</div>`)}</div>`
}

mount(hx`
  <div>
    ${() => {
      const val = stream.byteLength > 0 ? stream.get() : null
      return hx`
        <div>
          ${renderValue(val)}
          <div class="bytes dim">${stream.byteLength} bytes</div>
        </div>
      `
    }}
  </div>
`, root, stream.recaller)
