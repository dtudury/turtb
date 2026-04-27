import { Stream } from './Stream.js'
import { archiveSync } from './archiveSync.js'

/**
 * Manages a collection of Streams, each identified by a hex-encoded public key.
 *
 * Calling open() with a publicKeyHex creates the Stream (if needed), wires up
 * archive persistence, and returns the same instance on every subsequent call —
 * so two callers opening the same key always share one stream.
 *
 * This is the natural home for peer sync (Steps 6 & 7): when a remote peer
 * announces data for a key, call open(key) to get a stream to pipe into.
 */
export class StreamRegistry {
  #streams = new Map()
  #dataDir

  /** @param {string} [dataDir='.stream'] */
  constructor (dataDir = '.stream') {
    this.#dataDir = dataDir
  }

  /**
   * Return the Stream for `publicKeyHex`, creating and persisting it if this
   * is the first call for that key.
   *
   * @param {string} publicKeyHex
   * @returns {Promise<Stream>}
   */
  async open (publicKeyHex) {
    if (this.#streams.has(publicKeyHex)) return this.#streams.get(publicKeyHex)
    const stream = new Stream()
    // Register before awaiting so concurrent open() calls return the same instance
    this.#streams.set(publicKeyHex, stream)
    await archiveSync(stream, this.#dataDir, publicKeyHex)
    return stream
  }

  /**
   * Return an already-open Stream, or undefined if it has not been opened yet.
   *
   * @param {string} publicKeyHex
   * @returns {Stream|undefined}
   */
  get (publicKeyHex) {
    return this.#streams.get(publicKeyHex)
  }

  /** Number of currently open streams. */
  get size () { return this.#streams.size }

  /** Iterate over [publicKeyHex, Stream] pairs. */
  [Symbol.iterator] () { return this.#streams.entries() }
}
