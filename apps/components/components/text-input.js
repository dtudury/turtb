/* eslint-env browser */
import { hx } from '../../../stream/hx.js'
import { mount } from '../../../stream/mount.js'

class HxTextInput extends HTMLElement {
  #stream = null
  #key = null

  set stream (s) { this.#stream = s }
  set key (k) { this.#key = k }

  connectedCallback () {
    this.attachShadow({ mode: 'open' })
    const stream = this.#stream
    const key = this.#key
    mount(hx`
      <style>
        :host { display: flex; flex-direction: column; gap: 0.4rem; }
        label { font-size: 0.75rem; color: var(--ink-dim, #888); text-transform: uppercase; letter-spacing: 0.05em; }
        input { font-family: monospace; font-size: 1rem; padding: 0.35rem 0.5rem; border: 1px solid var(--rule, #ccc); background: var(--bg, white); color: var(--ink, black); border-radius: 4px; }
        .preview { font-size: 0.85rem; color: var(--ink-dim, #888); min-height: 1.2em; }
      </style>
      <label>${() => stream.get(key, 'label')}</label>
      <input
        value="${() => stream.get(key, 'value') ?? ''}"
        placeholder="${() => stream.get(key, 'placeholder') ?? ''}"
        oninput="${() => e => stream.set(key, 'value', e.target.value)}"
      />
      <span class="preview">${() => stream.get(key, 'value') || ' '}</span>
    `, this.shadowRoot, stream.recaller)
  }
}

customElements.define('hx-text-input', HxTextInput)
