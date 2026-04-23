import { Recaller } from './utils/Recaller.js'
import { TurtleCodecRegistry } from './TurtleCodecRegistry.js'

function * changedPaths (terrapin, addrA, addrB, path = []) {
  if (addrA === addrB) return
  yield path
  const refsA = addrA !== undefined ? terrapin.decode(addrA, true) : undefined
  const refsB = addrB !== undefined ? terrapin.decode(addrB, true) : undefined
  if (refsA && refsB && typeof refsA === 'object' && typeof refsB === 'object') {
    const keys = new Set([...Object.keys(refsA), ...Object.keys(refsB)])
    for (const key of keys) {
      if (refsA[key] !== refsB[key]) {
        yield * changedPaths(terrapin, refsA[key], refsB[key], [...path, key])
      }
    }
  }
}

/**
 * Extends TurtleCodecRegistry with:
 * - Recaller integration for reactive dependency tracking on appends
 * - Path-based get/set and reactive watch
 * - `clone` to snapshot state at a given address
 */
export class Terrapin extends TurtleCodecRegistry {
  constructor (recaller = new Recaller('Terrapin(default)')) {
    super()
    this.recaller = recaller
  }

  /** @type {number} */
  get byteLength () {
    this.recaller.reportKeyAccess(this, 'length', 'get byteLength', 'Terrapin')
    return super.byteLength
  }

  /**
   * Appends code and notifies reactive watchers.
   * @param {Uint8Array} code
   * @returns {number}
   */
  appendCode (code) {
    const result = super.appendCode(code)
    this.recaller.reportKeyMutation(this, 'length', 'appendCode', 'Terrapin')
    return result
  }

  /**
   * Decode the value at address and navigate into it by path.
   * If the first argument is a number it is used as the address; otherwise
   * the last appended address is used and all arguments are treated as path.
   * Only registers reactive dependencies when no explicit address is given.
   * @param {...(number | string)} args
   * @returns {any}
   */
  get (...args) {
    let address
    if (typeof args[0] === 'number') {
      address = args.shift()
    } else {
      address = this.byteLength - 1 // accessing byteLength registers a dependency on appends
      this.recaller.reportKeyAccess(this, JSON.stringify(args), 'get', 'Terrapin')
    }
    let value = this.decode(address)
    for (const key of args) {
      if (value == null) return undefined
      value = value[key]
    }
    return value
  }

  /**
   * Encode a new value, optionally updating at a path within an existing encoded object.
   * If the first argument is a number it is used as the address; otherwise the last
   * appended address is used. The last argument is the value to set. Any
   * arguments in between are the path within the decoded object to update.
   * Returns the address of the newly appended code.
   * @param {...(number | string | any)} args
   * @returns {number}
   */
  set (...args) {
    const address = typeof args[0] === 'number' ? args.shift() : this.byteLength - 1
    const value = args.pop()
    const path = args
    let root = value
    if (path.length) {
      root = this.decode(address)
      let current = root
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]]
      }
      current[path[path.length - 1]] = value
    }
    const prevAddress = this.byteLength > 0 ? this.byteLength - 1 : undefined
    const result = this.appendCode(this.encode(root))
    const newAddress = this.byteLength - 1
    for (const path of changedPaths(this, prevAddress, newAddress)) {
      this.recaller.reportKeyMutation(this, JSON.stringify(path), 'set', 'Terrapin')
    }
    return result
  }

  /**
   * Call f immediately, tracking any get() calls made during execution.
   * Re-runs f whenever a subsequent set() affects a path that was accessed.
   * Each re-run establishes a fresh set of tracked dependencies.
   * @param {string} name
   * @param {function} f
   */
  watch (name, f) {
    this.recaller.watch(name, f)
  }

  /**
   * @param {number} address
   * @param {Recaller} [recaller]
   * @returns {Terrapin}
   */
  clone (address, recaller = this.recaller) {
    const index = this.byteIndexToIndex(address)
    const terrapin = new Terrapin(recaller)
    terrapin.offsetUint8Arrays = this.offsetUint8Arrays.slice(0, index + 1)
    terrapin.codeToAddressMap = this.codeToAddressMap.clone(address)
    return terrapin
  }
}
