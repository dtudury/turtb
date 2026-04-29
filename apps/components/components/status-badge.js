/* eslint-env browser */
import { hx } from '../../../stream/hx.js'
import { mount } from '../../../stream/mount.js'

const LABELS = {
  null:          { text: 'local only',    cls: 'idle'   },
  'local-only':  { text: 'local only',    cls: 'idle'   },
  'connecting':  { text: 'connecting…',   cls: 'wait'   },
  'server-sync': { text: 'server sync',   cls: 'ok'     },
  'reconnecting':{ text: 'reconnecting…', cls: 'wait'   },
  'disconnected':{ text: 'disconnected',  cls: 'err'    },
}

class HxStatusBadge extends HTMLElement {
  #syncState = null
  #recaller = null

  set syncState (s) { this.#syncState = s }
  set recaller (r) { this.#recaller = r }

  connectedCallback () {
    this.attachShadow({ mode: 'open' })
    const syncState = this.#syncState
    const recaller = this.#recaller

    mount(hx`
      <style>
        :host { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; }
        .pill { padding: 0.15rem 0.55rem; border-radius: 999px; white-space: nowrap; }
        .pill.ok   { background: #d4edda; color: #155724; }
        .pill.wait { background: #fff3cd; color: #856404; }
        .pill.err  { background: #f8d7da; color: #721c24; }
        .pill.idle { background: var(--bg-alt, #eee); color: var(--ink-dim, #666); }
        .username  { color: var(--ink-dim, #888); }
      </style>
      ${() => {
        recaller.reportKeyAccess(syncState, 'status')
        const { text, cls } = LABELS[syncState.status] ?? LABELS[null]
        return hx`
          ${syncState.username ? hx`<span class="username">${syncState.username}</span>` : null}
          <span class="${'pill ' + cls}">${text}</span>
        `
      }}
    `, this.shadowRoot, recaller)
  }
}

customElements.define('hx-status-badge', HxStatusBadge)
