import { Recaller } from './utils/Recaller.js'
import { CodecRegistry } from './CodecRegistry.js'
import { Signature } from './Signature.js'
import { verifySignature } from './Signer.js'

/**
 * Thrown by conditionalSet() when the stream has advanced past the expected tip.
 * Catch this to detect write conflicts and retry with a fresh read.
 */
export class ConflictError extends Error {
  /**
   * @param {number} expectedTip  byteLength the caller observed
   * @param {number} actualTip    byteLength at the moment of the attempted write
   */
  constructor (expectedTip, actualTip) {
    super(`conflict: expected tip ${expectedTip} but stream is at ${actualTip}`)
    this.name = 'ConflictError'
    this.expectedTip = expectedTip
    this.actualTip = actualTip
  }
}

/**
 * Yield every path where addrA and addrB differ, including the root.
 * Compares by address so unchanged subtrees are skipped in O(1).
 */
function * changedPaths (stream, addrA, addrB, path = []) {
  if (addrA === addrB) return
  yield path
  const refsA = addrA !== undefined ? stream.decode(addrA, true) : undefined
  const refsB = addrB !== undefined ? stream.decode(addrB, true) : undefined
  const isPlain = v => v != null && typeof v === 'object' && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
  const objA = isPlain(refsA)
  const objB = isPlain(refsB)
  if (objA || objB) {
    const keys = new Set([...Object.keys(refsA ?? {}), ...Object.keys(refsB ?? {})])
    for (const key of keys) {
      const a = objA ? refsA[key] : undefined
      const b = objB ? refsB[key] : undefined
      if (a !== b) yield * changedPaths(stream, a, b, [...path, key])
    }
  }
}

/**
 * A Stream is a reactive, signed, append-only data store.
 *
 * It combines:
 *   - CodecRegistry: encode/decode any JS value to/from bytes
 *   - Recaller: fine-grained reactive dependency tracking (watch/get/set)
 *   - secp256k1 signing: sign the stream contents, verify signatures
 *
 * This is the primary user-facing class. The layers below it
 * (Addressifier, CodecRegistry) exist to serve it.
 */
export class Stream extends CodecRegistry {
  #recaller
  #signedLength = 0

  /**
   * @param {Recaller} [recaller]
   */
  constructor (recaller = new Recaller('Stream')) {
    super()
    this.#recaller = recaller
  }

  get recaller () { return this.#recaller }

  get byteLength () {
    this.#recaller.reportKeyAccess(this, 'length')
    return super.byteLength
  }

  /**
   * Append code and notify reactive watchers.
   * @param {Uint8Array} code
   * @returns {number}
   */
  append (code) {
    const address = super.append(code)
    this.#recaller.reportKeyMutation(this, 'length')
    return address
  }

  /**
   * Decode the value at a path within the most-recently-appended value,
   * registering reactive dependencies so watchers re-run on changes.
   *
   * If the first argument is a number it is treated as an explicit address
   * (no dependency registered). Otherwise byteLength is accessed (dependency
   * registered) and all arguments are treated as a path into the decoded value.
   *
   * @param {...(number|string)} args
   * @returns {any}
   */
  get (...args) {
    let address
    if (typeof args[0] === 'number') {
      address = args.shift()
    } else {
      address = super.byteLength - 1
      // Register both dependencies so watchers re-run on any append() (external
      // sync via makeWritableStream) AND on fine-grained path mutations (set()).
      this.#recaller.reportKeyAccess(this, 'length')
      this.#recaller.reportKeyAccess(this, JSON.stringify(args))
    }
    if (address < 0) return undefined
    let value = this.decode(address)
    for (const key of args) {
      if (value == null) return undefined
      value = value[key]
    }
    return value
  }

  /**
   * Encode and append a new value, optionally updating at a path within the
   * current top-level decoded value. Notifies reactive watchers of which paths
   * changed.
   *
   * Signature: set([address,] ...path, value)
   * - If first arg is a number, use it as the base address.
   * - The last argument is always the value to set.
   * - Intermediate arguments are the path to update.
   *
   * @param {...(number|string|any)} args
   * @returns {number} address of the newly appended code
   */
  set (...args) {
    const baseAddress = typeof args[0] === 'number' ? args.shift() : super.byteLength - 1
    const value = args.pop()
    const path = args

    let root = value
    if (path.length && baseAddress >= 0) {
      root = this.decode(baseAddress)
      let node = root
      for (let i = 0; i < path.length - 1; i++) node = node[path[i]]
      node[path[path.length - 1]] = value
    }

    const prevAddress = super.byteLength > 0 ? super.byteLength - 1 : undefined
    const address = this.append(this.encode(root))
    const newAddress = super.byteLength - 1

    for (const changed of changedPaths(this, prevAddress, newAddress)) {
      this.#recaller.reportKeyMutation(this, JSON.stringify(changed))
    }
    return address
  }

  /**
   * Call f immediately, tracking get() calls. Re-runs f whenever a
   * subsequent set() touches a path that was accessed.
   * @param {string} name
   * @param {function} f
   */
  watch (name, f) {
    this.#recaller.watch(name, f)
  }

  /**
   * Stop watching a function that was previously passed to watch().
   * @param {function} f
   */
  unwatch (f) {
    this.#recaller.unwatch(f)
  }

  /**
   * Like set(), but only succeeds if the stream's current byteLength equals
   * `expectedTip` — i.e., nothing has been written since the caller last read.
   *
   * Throws ConflictError when the precondition fails. Callers should catch it,
   * re-read the latest state, re-apply their change, and retry.
   *
   * @param {number} expectedTip  byteLength observed when the change was prepared
   * @param {...(string|any)} args  same arguments as set()
   * @returns {number} address of the newly appended code
   */
  conditionalSet (expectedTip, ...args) {
    const actual = super.byteLength
    if (actual !== expectedTip) throw new ConflictError(expectedTip, actual)
    return this.set(...args)
  }

  /**
   * Snapshot this stream up to (and including) `address`.
   * The returned Stream shares no mutable state with the original.
   * @param {number} address
   * @param {Recaller} [recaller]
   * @returns {Stream}
   */
  clone (address, recaller = this.#recaller) {
    return this._applyClone(new Stream(recaller), address)
  }

  // ── Signing ──────────────────────────────────────────────────────────────

  /**
   * Sign the bytes appended since the last signature (or from the start).
   * Appends the signature as a new chunk and advances the signed cursor.
   *
   * @param {import('./Signer.js').Signer} signer
   * @param {string} streamName
   * @returns {Promise.<Signature>}
   */
  async sign (signer, streamName) {
    const before = super.byteLength
    const bytes = this.slice(this.#signedLength, before - 1)
    const compactRawBytes = await signer.sign(streamName, bytes)
    if (super.byteLength !== before) throw new Error('stream was modified while signing')
    const sig = new Signature(this.#signedLength, compactRawBytes)
    this.append(this.encode(sig))
    this.#signedLength = before
    return sig
  }

  /**
   * Verify a signature against this stream's contents.
   * @param {Signature} sig
   * @param {Uint8Array} publicKey
   * @returns {Promise.<boolean>}
   */
  async verify (sig, publicKey) {
    const sigCode = this.encode(sig)
    const sigAddress = this.addressOf(sigCode)
    const bytes = this.slice(sig.address, sigAddress - sigCode.length)
    return verifySignature(publicKey, bytes, sig.compactRawBytes)
  }

  /**
   * Like makeWritableStream(), but verifies every SIGNATURE chunk against
   * `publicKey` before accepting it. Non-signature chunks are appended as
   * normal; the entire write is rejected (WritableStream errors) if any
   * signature fails to verify.
   *
   * Use this when receiving data from an untrusted source (a peer, a file
   * written by someone else) to ensure every signed range is authentic.
   *
   * @param {Uint8Array} publicKey
   * @param {number} [maxFrameSize]
   * @returns {WritableStream}
   */
  makeVerifiedWritableStream (publicKey, maxFrameSize = 64 * 1024 * 1024) {
    const self = this
    let buf = new Uint8Array(0)
    return new WritableStream({
      async write (incoming) {
        const next = new Uint8Array(buf.length + incoming.length)
        next.set(buf); next.set(incoming, buf.length)
        buf = next
        while (buf.length >= 4) {
          const len = new Uint32Array(buf.slice(0, 4).buffer)[0]
          if (len === 0) throw new Error('malformed frame: zero-length chunk')
          if (len > maxFrameSize) throw new Error(`malformed frame: length ${len} exceeds ${maxFrameSize}`)
          if (buf.length < 4 + len) break
          const code = buf.slice(4, 4 + len)
          buf = buf.slice(4 + len)

          if (self.addressOf(code) !== undefined) continue // already present, skip

          // If this is a SIGNATURE chunk, verify it covers the bytes since its
          // stated start address before we accept it into the store.
          const codec = self.footerToCodec[code.at(-1)]
          if (codec?.type === 'SIGNATURE') {
            const sig = self.decode(code)
            const bytes = self.slice(sig.address, self.byteLength - 1)
            const valid = await verifySignature(publicKey, bytes, sig.compactRawBytes)
            if (!valid) throw new Error('signature verification failed')
          }

          self.append(code)
        }
      }
    })
  }
}
