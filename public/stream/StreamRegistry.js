import { Stream } from './Stream.js'

/**
 * Manages a collection of Streams keyed by hex-encoded public key.
 *
 * Accepts an optional factory function that is called whenever a new stream
 * is opened. The factory receives the publicKeyHex and should return a
 * (optionally async) Stream with whatever persistence or sync wired up.
 *
 * If no factory is provided, plain in-memory Streams are created.
 *
 * Examples:
 *
 *   // plain in-memory
 *   new StreamRegistry()
 *
 *   // archive-backed
 *   new StreamRegistry(async key => {
 *     const stream = new Stream()
 *     await archiveSync(stream, dataDir, key)
 *     return stream
 *   })
 *
 *   // S3-backed
 *   new StreamRegistry(async key => {
 *     const stream = new Stream()
 *     await s3Sync(stream, key, s3Config)
 *     return stream
 *   })
 */
export class StreamRegistry {
  #streams = new Map()
  #factory

  /** @param {(publicKeyHex: string) => Stream | Promise<Stream>} [factory] */
  constructor (factory = () => new Stream()) {
    this.#factory = factory
  }

  /**
   * Return the Stream for `publicKeyHex`, creating it via the factory if this
   * is the first call for that key.
   *
   * The stream is registered immediately (before the factory resolves) so
   * concurrent open() calls always return the same instance.
   *
   * @param {string} publicKeyHex
   * @returns {Promise<Stream>}
   */
  async open (publicKeyHex) {
    if (this.#streams.has(publicKeyHex)) return this.#streams.get(publicKeyHex)
    // Reserve the slot with a placeholder so concurrent calls get the same
    // Promise rather than racing to create separate streams.
    let resolve
    const placeholder = new Promise(r => { resolve = r })
    this.#streams.set(publicKeyHex, placeholder)
    const stream = await this.#factory(publicKeyHex)
    this.#streams.set(publicKeyHex, stream)
    resolve(stream)
    return stream
  }

  /**
   * Return an already-open Stream, or undefined if it has not been opened yet.
   * @param {string} publicKeyHex
   * @returns {Stream|undefined}
   */
  get (publicKeyHex) {
    const entry = this.#streams.get(publicKeyHex)
    // Don't expose a Promise — only return resolved Streams
    return entry instanceof Stream ? entry : undefined
  }

  /** Number of currently open (or opening) streams. */
  get size () { return this.#streams.size }

  /** Iterate over [publicKeyHex, Stream] pairs (only fully-opened streams). */
  [Symbol.iterator] () {
    return (function * (map) {
      for (const [k, v] of map) {
        if (v instanceof Stream) yield [k, v]
      }
    })(this.#streams)
  }
}
