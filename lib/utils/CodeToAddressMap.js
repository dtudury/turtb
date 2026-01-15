export class CodeToAddressMap {
  constructor (bytes, address = null, branches = []) {
    this.bytes = bytes
    this.address = address
    this.branches = branches
  }

  getAddressOrSetter (encoded) {
    if (!this.bytes) {
      this.bytes = encoded
      return address => { this.address = address }
    } else {
      const matchingBits = countMatchingBits(encoded, this.bytes)
      console.log(matchingBits, encoded, this.bytes)
      if (matchingBits === this.bytes.length * 8 && encoded.length === this.bytes.length) {
        if (this.address === null) {
          return (address) => {
            this.address = address
            this.bytes = encoded
          }
        } else return this.address
      } else {
        const matchingBytes = encoded.slice(matchingBits << 3)
        if (this.branches[matchingBits]) {
          return this.branches[matchingBits].getAddressOrSetter(matchingBytes)
        } else {
          return address => {
            this.branches[matchingBits] = new CodeToAddressMap(matchingBytes, address)
          }
        }
      }
    }
  }
}

/**
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
export function countMatchingBits (a, b) {
  let bits = 0
  for (let i = 0; i < a.length && i < b.length; ++i) {
    const aByte = a.at(i)
    const bByte = b.at(i)
    let j = 0
    while (aByte >> j !== bByte >> j) ++j
    bits += 8 - j
    if (j) break
  }
  return bits
}
