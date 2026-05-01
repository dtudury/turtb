import { Stream } from './Stream.js'
import { Repository } from './Repository.js'

/**
 * Manages a collection of Repositories keyed by hex-encoded public key.
 *
 * Accepts an optional factory function that is called whenever a new repository
 * is opened. The factory receives the publicKeyHex and should return a
 * (optionally async) Repository with whatever persistence or sync wired up.
 *
 * If no factory is provided, plain in-memory Repositories are created.
 *
 * Examples:
 *
 *   // plain in-memory
 *   new RepositoryRegistry()
 *
 *   // archive-backed
 *   new RepositoryRegistry(async key => {
 *     const repo = new Repository()
 *     await archiveSync(repo, dataDir, key)
 *     return repo
 *   })
 *
 *   // S3-backed
 *   new RepositoryRegistry(async key => {
 *     const repo = new Repository()
 *     await s3Sync(repo, key, s3Config)
 *     return repo
 *   })
 */
export class RepositoryRegistry {
  #streams = new Map()
  #factory
  #openCallbacks = new Set()

  /** @param {(publicKeyHex: string) => Repository | Promise<Repository>} [factory] */
  constructor (factory = () => new Repository()) {
    this.#factory = factory
  }

  /**
   * Return the Repository for `publicKeyHex`, creating it via the factory if
   * this is the first call for that key.
   *
   * The repository is registered immediately (before the factory resolves) so
   * concurrent open() calls always return the same instance.
   *
   * @param {string} publicKeyHex
   * @returns {Promise<Repository>}
   */
  async open (publicKeyHex) {
    if (this.#streams.has(publicKeyHex)) return this.#streams.get(publicKeyHex)
    let resolve
    const placeholder = new Promise(r => { resolve = r })
    this.#streams.set(publicKeyHex, placeholder)
    const stream = await this.#factory(publicKeyHex)
    this.#streams.set(publicKeyHex, stream)
    resolve(stream)
    for (const cb of this.#openCallbacks) cb(publicKeyHex, stream)
    return stream
  }

  /** Register a callback invoked whenever a new repository is fully opened. */
  onOpen (cb) { this.#openCallbacks.add(cb) }

  /** Remove a previously registered onOpen callback. */
  offOpen (cb) { this.#openCallbacks.delete(cb) }

  /**
   * Return an already-open Repository, or undefined if not opened yet.
   * @param {string} publicKeyHex
   * @returns {Repository|undefined}
   */
  get (publicKeyHex) {
    const entry = this.#streams.get(publicKeyHex)
    return entry instanceof Stream ? entry : undefined
  }

  /** Number of currently open (or opening) repositories. */
  get size () { return this.#streams.size }

  /** Iterate over [publicKeyHex, Repository] pairs (only fully-opened). */
  [Symbol.iterator] () {
    return (function * (map) {
      for (const [k, v] of map) {
        if (v instanceof Stream) yield [k, v]
      }
    })(this.#streams)
  }
}
