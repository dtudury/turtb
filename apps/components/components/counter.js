/* eslint-env browser */
import { hx } from '../../../stream/hx.js'
import { mount } from '../../../stream/mount.js'

class HxCounter extends HTMLElement {
  #stream = null
  #key = null

  set stream (s) { this.#stream = s }
  set key (k) { this.#key = k }

  connectedCallback () {
    this.attachShadow({ mode: 'open' })
    const stream = this.#stream
    const key = this.#key
    const inc = () => stream.set(key, 'value', (stream.get(key, 'value') ?? 0) + 1)
    const dec = () => stream.set(key, 'value', (stream.get(key, 'value') ?? 0) - 1)
    mount(hx`
      <style>
        :host { display: inline-flex; align-items: center; gap: 0.75rem; font-family: monospace; font-size: 1.25rem; }
        button { font-family: monospace; font-size: 1rem; width: 2rem; padding: 0.15rem 0; text-align: center; cursor: pointer; }
        .value { min-width: 3ch; text-align: center; }
        .label { font-size: 0.85rem; color: var(--ink-dim, #888); margin-right: 0.25rem; }
      </style>
      <span class="label">${() => stream.get(key, 'label')}</span>
      <button onclick="${() => dec}">−</button>
      <span class="value">${() => stream.get(key, 'value') ?? 0}</span>
      <button onclick="${() => inc}">+</button>
    `, this.shadowRoot, stream.recaller)
  }
}

customElements.define('hx-counter', HxCounter)
