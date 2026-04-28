import { Stream } from '../../stream/Stream.js'
import { hx, mount } from '../../stream/hx.js'

const stream = new Stream()

// ── Counter ───────────────────────────────────────────────────────────────

function Counter (key) {
  const inc = () => stream.set(key, (stream.get(key) ?? 0) + 1)
  const dec = () => stream.set(key, (stream.get(key) ?? 0) - 1)
  return hx`
    <div class="counter">
      <button onclick="${dec}">−</button>
      <span class="counter-value">${() => stream.get(key) ?? 0}</span>
      <button onclick="${inc}">+</button>
    </div>
  `
}

// ── Demo ──────────────────────────────────────────────────────────────────

mount(hx`
  <div>
    <div class="demo-section">
      <div class="demo-label">counter</div>
      ${Counter('count')}
    </div>
  </div>
`, document.getElementById('root'), stream.recaller)
