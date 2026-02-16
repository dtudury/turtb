export class Signature {
  /**
   * @param {number} address
   * @param {Uint8Array} compactRawBytes
   */
  constructor (address, compactRawBytes) {
    this.address = address
    this.compactRawBytes = compactRawBytes
  }
}
