/* eslint-env browser */
import { turtle } from '../../../stream/turtle.js'
import { mount } from '../../../stream/mount.js'

class TurtleAccordion extends HTMLElement {
  #stream = null
  #key = null

  set stream (s) { this.#stream = s }
  set key (k) { this.#key = k }

  connectedCallback () {
    this.attachShadow({ mode: 'open' })
    const stream = this.#stream
    const key = this.#key
    const toggle = () => stream.set(key, 'open', !stream.get(key, 'open'))
    mount(turtle`
      <style>
        :host { display: block; border: 1px solid var(--rule, #ccc); border-radius: 4px; overflow: hidden; }
        button {
          width: 100%; display: flex; justify-content: space-between; align-items: center;
          padding: 0.6rem 0.75rem; background: none; border: none; cursor: pointer;
          font-size: 1rem; color: var(--ink, black); text-align: left;
        }
        button:hover { background: var(--bg-alt, #f5f5f5); }
        .arrow { transition: transform 0.2s; display: inline-block; }
        .arrow.open { transform: rotate(90deg); }
        .body { padding: 0.75rem; border-top: 1px solid var(--rule, #ccc); font-size: 0.9rem; line-height: 1.5; }
      </style>
      <button onclick="${() => toggle}">
        <span>${() => stream.get(key, 'title')}</span>
        <span class="${() => 'arrow' + (stream.get(key, 'open') ? ' open' : '')}">▶</span>
      </button>
      ${() => stream.get(key, 'open') ? turtle`<div class="body">${() => stream.get(key, 'body')}</div>` : null}
    `, this.shadowRoot, stream.recaller)
  }
}

customElements.define('turtle-accordion', TurtleAccordion)
