/**
 * hx — reactive HTML template engine
 *
 * Usage:
 *   const nodes = hx`<div class=${cls}>${() => stream.get('name')}</div>`
 *   mount(nodes, document.body, stream.recaller)
 *
 * `hx` parses the template into a virtual tree of HxElement / HxText nodes.
 * Functions interpolated into the template are stored as-is (not called).
 * `mount` renders the virtual tree to the DOM and sets up Recaller watchers
 * so function slots re-render whenever the data they read changes.
 *
 * A "slot" can be:
 *   - a string or number      → rendered as a text node
 *   - a function              → called in a watcher; result re-rendered on change
 *   - an HxElement            → mounted as a subtree
 *   - an array                → each item rendered as a slot
 *   - a DOM Node              → inserted directly
 *   - null / undefined        → renders nothing
 */

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
])

// ── Virtual tree types ───────────────────────────────────────────────────

export class HxElement {
  constructor (tag, attrs, children) {
    this.tag = tag
    this.attrs = attrs     // Array.<{name: string, value: string|any[]|any}>
    this.children = children // Array of slots
  }
}

export class HxText {
  constructor (value) {
    this.value = value // string
  }
}

// ── Scanner ──────────────────────────────────────────────────────────────

class Scanner {
  #tokens
  #i = 0

  constructor (strings, values) {
    this.#tokens = []
    for (let i = 0; i < strings.length; i++) {
      for (const c of strings[i]) this.#tokens.push(c)
      if (i < values.length) this.#tokens.push({ slot: values[i] })
    }
  }

  peek (offset = 0) { return this.#tokens[this.#i + offset] }
  isSlot (offset = 0) { return this.peek(offset)?.slot !== undefined }
  advance () { return this.#tokens[this.#i++] }
  get done () { return this.#i >= this.#tokens.length }

  readIf (str) {
    for (let i = 0; i < str.length; i++) {
      const c = this.peek(i)
      if (!c || c.slot !== undefined || c !== str[i]) return false
    }
    this.#i += str.length
    return true
  }

  assertChar (re) {
    const c = this.peek()
    if (!c || c.slot !== undefined || !c.match(re)) {
      throw new Error(`expected ${re}, got ${JSON.stringify(c)} at token ${this.#i}`)
    }
    this.#i++
  }

  skipSpace () {
    while (!this.done && !this.isSlot() && this.peek().match(/\s/)) this.#i++
  }

  /** Read chars until regex matches or a slot is hit. */
  readTo (re) {
    const parts = []
    while (!this.done && !this.isSlot() && !this.peek().match(re)) {
      const c = this.peek()
      if (c === '&') {
        parts.push(this.#readEscaped())
      } else {
        parts.push(c)
        this.#i++
      }
    }
    return parts.join('')
  }

  #readEscaped () {
    this.#i++ // consume '&'
    for (const [seq, char] of [['amp;', '&'], ['apos;', "'"], ['gt;', '>'], ['lt;', '<'], ['quot;', '"'], ['nbsp;', '\u00a0']]) {
      if (this.readIf(seq)) return char
    }
    throw new Error('unknown HTML escape sequence')
  }

  /**
   * Read an attribute value that may contain interleaved slots and literal text.
   * Returns a string if there are no slots, otherwise an array of string/slot parts.
   * @param {string} closingQuote
   */
  readAttrValue (closingQuote) {
    const parts = []
    while (!this.done) {
      if (this.isSlot()) {
        parts.push(this.advance().slot)
      } else if (this.peek() === closingQuote) {
        break
      } else if (this.peek() === '&') {
        parts.push(this.#readEscaped())
      } else {
        // accumulate literal chars
        let s = ''
        while (!this.done && !this.isSlot() && this.peek() !== closingQuote && this.peek() !== '&') {
          s += this.peek()
          this.#i++
        }
        if (s) parts.push(s)
      }
    }
    if (parts.every(p => typeof p === 'string')) return parts.join('')
    return parts
  }
}

// ── Parser ───────────────────────────────────────────────────────────────

const END_ATTRS = Symbol('end')

function parseAttr (sc) {
  sc.skipSpace()
  const c = sc.peek()
  if (!c || c === '/' || c === '>') return END_ATTRS
  // dynamic attribute object (e.g. ${attrs})
  if (sc.isSlot()) return sc.advance().slot
  const name = sc.readTo(/[\s=/>]/)
  if (!name) throw new Error('attribute must have a name')
  sc.skipSpace()
  if (!sc.readIf('=')) return { name }
  sc.skipSpace()
  if (sc.isSlot()) return { name, value: sc.advance().slot }
  const quote = (sc.peek() === '"' || sc.peek() === "'") ? sc.advance() : null
  if (quote) {
    const value = sc.readAttrValue(quote)
    sc.assertChar(new RegExp(quote))
    return { name, value }
  }
  return { name, value: sc.readTo(/[\s/>]/) }
}

function parseAttrs (sc) {
  const attrs = []
  while (true) {
    const attr = parseAttr(sc)
    if (attr === END_ATTRS) return attrs
    attrs.push(attr)
  }
}

function parseTag (sc) {
  sc.skipSpace()
  if (sc.isSlot()) return sc.advance().slot
  return sc.readTo(/[\s/>]/)
}

function parseElement (sc) {
  // dynamic slot
  if (sc.isSlot()) return sc.advance().slot
  if (sc.peek() !== '<') {
    const text = sc.readTo(/</)
    return text ? new HxText(text) : null
  }
  sc.assertChar(/</)
  const closing = sc.readIf('/')
  const tag = parseTag(sc)
  const isVoid = VOID.has(tag)
  const attrs = parseAttrs(sc)
  const selfClose = sc.readIf('/') || isVoid
  sc.assertChar(/>/)
  if (closing) return { _closing: tag }
  const children = selfClose ? [] : parseChildren(sc, tag)
  return new HxElement(tag, attrs, children)
}

function parseChildren (sc, closingTag) {
  const children = []
  while (!sc.done) {
    const node = parseElement(sc)
    if (node === null) continue
    if (node?._closing) return children
    children.push(node)
  }
  return children
}

/**
 * Tagged template literal — parses the template into a virtual tree.
 * @param {TemplateStringsArray} strings
 * @param {...any} values
 * @returns {Array} array of HxElement / HxText / slot values
 */
export function hx (strings, ...values) {
  const sc = new Scanner(strings, values)
  return parseChildren(sc, null)
}

// ── DOM mounting ─────────────────────────────────────────────────────────

/**
 * Mount an array of virtual nodes into `container`, setting up reactive
 * watchers via `recaller` for any function slots.
 *
 * @param {Array} nodes  result of hx``
 * @param {Element} container  DOM element to append into
 * @param {import('./utils/Recaller.js').Recaller} recaller
 */
export function mount (nodes, container, recaller) {
  for (const node of [nodes].flat()) {
    mountNode(node, container, recaller)
  }
}

function mountNode (node, container, recaller) {
  if (node == null) return
  if (Array.isArray(node)) {
    node.forEach(n => mountNode(n, container, recaller))
    return
  }
  if (node instanceof HxElement) {
    const el = document.createElementNS(
      node.attrs.find(a => a?.name === 'xmlns')?.value ?? 'http://www.w3.org/1999/xhtml',
      node.tag
    )
    for (const attr of node.attrs) {
      if (attr == null) continue
      applyAttr(el, attr, recaller)
    }
    mount(node.children, el, recaller)
    container.appendChild(el)
    return
  }
  if (node instanceof HxText) {
    container.appendChild(document.createTextNode(node.value))
    return
  }
  if (node instanceof Node) {
    container.appendChild(node)
    return
  }
  if (typeof node === 'function') {
    mountSlot(node, container, recaller)
    return
  }
  // primitive — string, number, etc.
  container.appendChild(document.createTextNode(String(node)))
}

/**
 * Mount a reactive function slot. Uses two comment nodes as anchors so the
 * rendered output can be replaced in-place when the watcher fires.
 */
function mountSlot (fn, container, recaller) {
  const start = document.createComment('')
  const end = document.createComment('')
  container.appendChild(start)
  container.appendChild(end)

  const name = fn.name || '(hx slot)'
  recaller.watch(name, () => {
    // Clear everything between the anchors
    while (start.nextSibling !== end) start.nextSibling.remove()
    // Render fresh output into a temp fragment, then insert before `end`
    const frag = document.createDocumentFragment()
    mountNode(fn(), frag, recaller)
    end.before(frag)
  })
}

/**
 * Apply a parsed attribute to a DOM element. Handles event listeners
 * (on* attrs), reactive function values, and static strings.
 */
function applyAttr (el, attr, recaller) {
  if (typeof attr === 'object' && !attr.name) {
    // spread: attr is a plain object of key→value pairs
    for (const [k, v] of Object.entries(attr)) applyAttr(el, { name: k, value: v }, recaller)
    return
  }
  const { name, value } = attr
  if (name.startsWith('on') && typeof value === 'function') {
    el.addEventListener(name.slice(2), value)
    return
  }
  if (typeof value === 'function') {
    const watchName = `attr:${name}`
    recaller.watch(watchName, () => setAttr(el, name, value()))
    return
  }
  if (Array.isArray(value)) {
    // mixed static/dynamic attribute value
    const parts = value
    recaller.watch(`attr:${name}`, () => {
      setAttr(el, name, parts.map(p => typeof p === 'function' ? p() : String(p ?? '')).join(''))
    })
    return
  }
  if (value !== undefined) setAttr(el, name, value)
  else el.toggleAttribute(name, true) // boolean attribute
}

function setAttr (el, name, value) {
  if (name === 'value' && 'value' in el) {
    el.value = value
  } else if (typeof value === 'boolean') {
    el.toggleAttribute(name, value)
  } else if (value == null) {
    el.removeAttribute(name)
  } else {
    el.setAttribute(name, value)
  }
}
