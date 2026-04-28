import { Recaller } from './utils/Recaller.js'
import { Stream } from './Stream.js'

/**
 * A Stream whose values are commit records.
 *
 * The stream itself is the commit log — each appended value is a commit:
 *   { message, date, dataAddress, parent }
 *
 * `dataAddress` points to the committed data within this same stream.
 * `parent` is the address of the previous commit record (undefined for the first).
 *
 * checkout() clones the repository at the last commit's dataAddress, giving
 * a working Stream whose get() immediately returns the last committed value.
 * Modifications to the working stream are isolated from the repository until
 * commit(workingStream) is called.
 */
export class Repository extends Stream {
  /**
   * The latest commit record, or null if nothing has been committed yet.
   * Accessing this registers a reactive dependency on the commit log length.
   * @returns {{ message: string, date: Date, dataAddress: number, parent: number|undefined }|null}
   */
  get lastCommit () {
    if (this.byteLength === 0) return null
    return this.get()
  }

  /**
   * Clone the repository at the last commit's data address.
   * The returned Stream's get() immediately returns the last committed value,
   * sharing all existing bytes with the repository (no copying).
   *
   * Returns an empty Stream if nothing has been committed yet.
   * @returns {Stream}
   */
  checkout () {
    const commit = this.lastCommit
    if (!commit) return new Stream()
    return this.clone(commit.dataAddress, new Recaller('checkout'))
  }

  /**
   * Iterate commits from newest to oldest.
   * @yields {{ message: string, date: Date, dataAddress: number, parent: number|undefined }}
   */
  * history () {
    let commit = this.lastCommit
    while (commit) {
      yield commit
      commit = commit.parent !== undefined ? this.decode(commit.parent) : null
    }
  }

  /**
   * Copy the current value of workingStream into the repository and append a
   * commit record referencing it by address.
   *
   * Chunks already present in the repository are reused (content-addressed
   * dedup), so only genuinely new data is written. Unchanged files cost nothing.
   *
   * @param {Stream} workingStream  the staged working stream from checkout()
   * @param {string} [message='']
   * @returns {number} address of the new commit record
   */
  commit (workingStream, message = '') {
    if (workingStream.byteLength === 0) throw new Error('nothing to commit')
    const parent = this.byteLength > 0 ? this.byteLength - 1 : undefined
    const dataAddress = this.copyFrom(workingStream, workingStream.byteLength - 1)
    const code = this.encode({ message, date: new Date(), dataAddress, parent })
    return this.append(code)
  }
}
