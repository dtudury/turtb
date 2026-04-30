/* eslint-env browser */
import { turtle } from '../../../stream/turtle.js'
import { mount } from '../../../stream/mount.js'

class TurtleToggle extends HTMLElement {
  #stream = null
  #key = null

  set stream (s) { this.#stream = s }
  set key (k) { this.#key = k }

  connectedCallback () {
    this.attachShadow({ mode: 'open' })
    const stream = this.#stream
    const key = this.#key
    const toggle = () => stream.set(key, 'value', !stream.get(key, 'value'))
    mount(turtle`
      <style>
        :host { display: inline-flex; align-items: center; gap: 0.75rem; }
        button {
          position: relative; width: 3rem; height: 1.5rem; border-radius: 999px;
          border: none; cursor: pointer; background: var(--ink-dim, #ccc);
          transition: background 0.2s;
        }
        button.on { background: var(--accent, #4a9eff); }
        button::after {
          content: ''; position: absolute; top: 3px; left: 3px;
          width: 1.125rem; height: 1.125rem; border-radius: 50%;
          background: white; transition: transform 0.2s;
        }
        button.on::after { transform: translateX(1.5rem); }
        .label { font-size: 0.85rem; }
      </style>
      <button class="${() => stream.get(key, 'value') ? 'on' : ''}" onclick="${() => toggle}"></button>
      <span class="label">${() => stream.get(key, 'label')}</span>
    `, this.shadowRoot, stream.recaller)
  }
}

customElements.define('turtle-toggle', TurtleToggle)
