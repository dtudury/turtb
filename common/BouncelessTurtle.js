import { Turtle } from './Turtle.js'

function * changedPaths (turtle, addrA, addrB, path = []) {
  if (addrA === addrB) return
  yield path
  const refsA = addrA !== undefined ? turtle.decode(addrA, true) : undefined
  const refsB = addrB !== undefined ? turtle.decode(addrB, true) : undefined
  if (refsA && refsB && typeof refsA === 'object' && typeof refsB === 'object') {
    const keys = new Set([...Object.keys(refsA), ...Object.keys(refsB)])
    for (const key of keys) {
      if (refsA[key] !== refsB[key]) {
        yield * changedPaths(turtle, refsA[key], refsB[key], [...path, key])
      }
    }
  }
}

export class BouncelessTurtle extends Turtle {
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
      this.recaller.reportKeyAccess(this, JSON.stringify(args), 'get', 'BouncelessTurtle')
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
      this.recaller.reportKeyMutation(this, JSON.stringify(path), 'set', 'BouncelessTurtle')
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
}
