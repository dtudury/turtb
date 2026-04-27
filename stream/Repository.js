import { Stream } from './Stream.js'

/**
 * Manages a mutable working Stream and an append-only committed Stream.
 *
 * The working stream is edited freely. Calling commit() copies the current
 * working value into the committed stream and appends a commit record
 * containing the message, a timestamp, and a dataAddress — a numeric
 * reference to the encoded data within the committed stream.
 *
 * Sub-values shared across commits are stored once in the committed stream
 * and referenced by address rather than re-serialised on every commit.
 */
export class Repository {
  working = new Stream()
  committed = new Stream()

  /**
   * Encode the current working value into the committed stream and append a
   * commit record that references it by address.
   *
   * @param {string} message
   * @returns {number} address of the commit record in the committed stream
   */
  commit (message) {
    if (this.working.byteLength === 0) throw new Error('nothing to commit')

    // Decode the working value and encode it into the committed stream.
    // encode() stores shared sub-values once via the content map, so
    // unchanged sub-trees are referenced by address rather than re-copied.
    const data = this.working.decode(this.working.byteLength - 1)
    const dataCode = this.committed.encode(data)
    const dataAddress = this.committed.addressOf(dataCode) ?? this.committed.append(dataCode)

    // Store the commit record with dataAddress as a reference, not inline data.
    const commitCode = this.committed.encode({ message, date: new Date(), dataAddress })
    return this.committed.addressOf(commitCode) ?? this.committed.append(commitCode)
  }
}
