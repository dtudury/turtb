/* eslint-env browser */
import { turtle } from '../../../stream/turtle.js'
import { mount } from '../../../stream/mount.js'

/**
 * createToaster — factory for a reactive toast notification system.
 *
 * @param {import('../../../stream/utils/Recaller.js').Recaller} recaller
 * @returns {{ show, dismiss, state, recaller }}
 */
export function createToaster (recaller) {
  const state = { items: [] }

  const toaster = {
    state,
    recaller,

    show (message, type = 'info', duration = 4000) {
      const id = Symbol()
      state.items = [...state.items, { id, message, type }]
      recaller.reportKeyMutation(state, 'items')
      if (duration > 0) setTimeout(() => toaster.dismiss(id), duration)
    },

    dismiss (id) {
      state.items = state.items.filter(t => t.id !== id)
      recaller.reportKeyMutation(state, 'items')
    }
  }

  return toaster
}

// ── TurtleToastContainer ─────────────────────────────────────────────────────

class TurtleToastContainer extends HTMLElement {
  #toaster = null
  set toaster (t) { this.#toaster = t }

  connectedCallback () {
    this.attachShadow({ mode: 'open' })
    const { state, recaller } = this.#toaster
    const dismiss = id => this.#toaster.dismiss(id)

    mount(turtle`
      <style>
        :host {
          position: fixed; bottom: 1.5rem; right: 1.5rem;
          display: flex; flex-direction: column; gap: 0.5rem;
          z-index: 9999; pointer-events: none;
        }
        .toast {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.6rem 1rem; border-radius: 6px; font-size: 0.875rem;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          pointer-events: all; cursor: default;
          animation: slide-in 0.2s ease;
        }
        @keyframes slide-in { from { opacity: 0; transform: translateX(1rem) } }
        .toast.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .toast.error   { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .toast.info    { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
        .toast.warning { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
        button { background: none; border: none; cursor: pointer; font-size: 1rem; opacity: 0.6; line-height: 1; padding: 0; }
        button:hover { opacity: 1; }
      </style>
      ${() => {
        recaller.reportKeyAccess(state, 'items')
        return state.items.map(({ id, message, type }) => turtle`
          <div class="${'toast ' + type}">
            <span>${message}</span>
            <button onclick="${() => () => dismiss(id)}">×</button>
          </div>
        `)
      }}
    `, this.shadowRoot, recaller)
  }
}

customElements.define('turtle-toast-container', TurtleToastContainer)
