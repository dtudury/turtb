export class Commit {
  /**
   * @param {Object} document
   * @param {Uint8Array} signature
   */
  constructor (document, signature = new Uint8Array(64)) {
    this.document = document
    this.signature = signature
  }
}
