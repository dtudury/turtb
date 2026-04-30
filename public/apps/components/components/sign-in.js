/* eslint-env browser */
import { turtle } from '../../../stream/turtle.js'
import { mount } from '../../../stream/mount.js'
import { Signer } from '../../../stream/Signer.js'

class TurtleSignIn extends HTMLElement {
  #stream = null
  #streamName = 'components'
  #keyIterations = 100000
  #cancelable = false
  #toaster = null
  #syncState = null
  #ui = { showForm: true, error: null }

  set stream (s) { this.#stream = s }
  set streamName (n) { this.#streamName = n }
  set keyIterations (n) { this.#keyIterations = n }
  set cancelable (v) { this.#cancelable = !!v }
  set toaster (t) { this.#toaster = t }
  set syncState (s) { this.#syncState = s }

  #patchSync (update) {
    Object.assign(this.#syncState, update)
    this.#stream.recaller.reportKeyMutation(this.#syncState, 'status')
  }

  #patchUi (update) {
    Object.assign(this.#ui, update)
    this.#stream.recaller.reportKeyMutation(this.#ui, 'showForm')
  }

  connectedCallback () {
    this.attachShadow({ mode: 'open' })
    const stream = this.#stream
    const recaller = stream.recaller
    const syncState = this.#syncState
    const ui = this.#ui

    mount(turtle`
      <style>
        :host { display: block; font-size: 0.9rem; }
        form   { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
        input  { font-family: monospace; padding: 0.3rem 0.5rem; border: 1px solid var(--rule, #ccc); background: var(--bg, white); color: var(--ink, black); border-radius: 4px; width: 9rem; }
        button { padding: 0.3rem 0.75rem; cursor: pointer; }
        .link  { background: none; border: none; padding: 0; cursor: pointer; color: var(--accent, #4a9eff); text-decoration: underline; font-size: inherit; }
        .error { color: #721c24; font-size: 0.8rem; }
        .row   { display: flex; align-items: center; gap: 0.5rem; }
      </style>
      ${() => {
        recaller.reportKeyAccess(ui, 'showForm')
        if (syncState) recaller.reportKeyAccess(syncState, 'status')
        const status = syncState?.status

        // Settled states — show a re-open link instead of the full form
        if (!ui.showForm || status === 'server-sync' || status === 'reconnecting') {
          return turtle`
            <div class="row">
              ${status === 'server-sync' || status === 'reconnecting'
                ? null
                : turtle`<button class="link" onclick="${() => () => this.#patchUi({ showForm: true, error: null })}">sign in</button>`
              }
            </div>
          `
        }

        return turtle`
          <form onsubmit="${() => e => { e.preventDefault(); this.#signIn(e.target) }}">
            <input name="streamName" placeholder="stream name" value="${this.#streamName}" required />
            <input name="username" placeholder="username" autocomplete="username" required />
            <input name="password" type="password" placeholder="password" autocomplete="current-password" required />
            <button type="submit">sign in</button>
            ${this.#cancelable
              ? turtle`<button type="button" onclick="${() => () => this.#cancel()}">cancel</button>`
              : null
            }
            ${() => {
              recaller.reportKeyAccess(ui, 'showForm')
              return ui.error ? turtle`<span class="error">${ui.error}</span>` : null
            }}
          </form>
        `
      }}
    `, this.shadowRoot, recaller)
  }

  async #signIn (form) {
    const streamName = form.streamName.value.trim()
    const username = form.username.value.trim()
    const password = form.password.value
    this.#patchUi({ error: null })

    let signer, publicKeyHex
    try {
      signer = new Signer(username, password, this.#keyIterations)
      const { publicKey } = await signer.keysFor(streamName)
      publicKeyHex = Array.from(publicKey).map(b => b.toString(16).padStart(2, '0')).join('')
    } catch (e) {
      this.#patchUi({ error: e.message })
      this.#toaster?.show(`Sign-in failed: ${e.message}`, 'error')
      return
    }

    // Check whether credentials match the server
    let serverKeyHex = null
    try {
      const info = await fetch('/api/info').then(r => r.json())
      serverKeyHex = info.primaryKeyHex
    } catch { /* server not available */ }

    if (serverKeyHex && serverKeyHex === publicKeyHex) {
      this.#patchSync({ status: 'server-sync', username })
      this.#patchUi({ showForm: false, error: null })
      this.#toaster?.show('Connected to server', 'success')
      this.#connect(signer, streamName, publicKeyHex)
    } else {
      this.#patchSync({ status: 'local-only', username })
      this.#patchUi({ showForm: false, error: null })
      if (serverKeyHex) {
        this.#toaster?.show('Credentials don\'t match the server — running locally', 'info')
      } else {
        this.#toaster?.show('Server not available — running locally', 'info')
      }
    }
  }

  #cancel () {
    this.#patchSync({ status: 'local-only', username: null })
    this.#patchUi({ showForm: false, error: null })
    this.#toaster?.show('Running in local-only mode', 'info')
  }

  #connect (signer, streamName, publicKeyHex) {
    const stream = this.#stream
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}`)
    ws.binaryType = 'arraybuffer'

    ws.addEventListener('open', async () => {
      ws.send(publicKeyHex)

      // Server → local
      const writer = stream.makeWritableStream().getWriter()
      ws.addEventListener('message', e => writer.write(new Uint8Array(e.data)).catch(() => {}))

      // Local → server (including signed chunks)
      const reader = stream.makeReadableStream().getReader()
      ;(async () => {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done || ws.readyState !== WebSocket.OPEN) break
            ws.send(value)
          }
        } catch {}
      })()

      // Sign current state so the server accepts our writes
      await stream.sign(signer, streamName)

      // Patch stream.set so future user writes trigger a sign.
      // This avoids watching stream 'length' which fires on every incoming
      // WS chunk and causes an infinite sign loop.
      const origSet = stream.set.bind(stream)
      stream.set = (...args) => {
        origSet(...args)
        stream.sign(signer, streamName).catch(console.error)
      }

      ws.addEventListener('close', () => {
        stream.set = origSet
      }, { once: true })
    })

    ws.addEventListener('close', () => {
      this.#patchSync({ status: 'reconnecting' })
      this.#toaster?.show('Connection lost — reconnecting…', 'warning')
      setTimeout(() => this.#connect(signer, streamName, publicKeyHex), 2000)
    })

    ws.addEventListener('error', () => ws.close())
  }
}

customElements.define('turtle-sign-in', TurtleSignIn)
