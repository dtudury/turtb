export class CodeToAddressMap {
  /** @type {Array.<CodeToAddressMap>} */
  branches = []
  /**
   * @param {number} offset
   * @param {number} address
   * @param {Uint8Array} code
   */
  constructor (offset = 0, code, address = -1) {
    this.offset = offset
    this.code = code
    this.address = address
  }

  /**
   * @param {number} address
   */
  clone (address) {
    if (address < this.address) throw new Error('starting branch must be in past of clone')
    const clone = new CodeToAddressMap(this.offset, this.code, this.address)
    for (const index in this.branches) {
      const branch = this.branches[index]
      if (branch.address <= address) clone.branches[index] = branch.clone(address)
    }
    return clone
  }

  /**
   * @param {Uint8Array} code
   * @returns {number}
   */
  get (code) {
    if (this.code === undefined || this.address === -1) return
    const { match, matchingBits } = this.compare(code)
    if (match) return this.address
    return this.branches[matchingBits]?.get?.(code)
  }

  /**
   * @param {Uint8Array} code
   * @param {number} address
   */
  set (code, address) {
    if (this.code === undefined || this.address === -1) {
      this.code = code
      this.address = address
      return
    }
    const { match, matchingBits, matchingBytes } = this.compare(code)
    if (match) throw new Error('setting an existing code/address is not allowed')
    if (this.branches[matchingBits]) return this.branches[matchingBits].set(code, address)
    this.branches[matchingBits] = new CodeToAddressMap(matchingBytes, code, address)
  }

  /**
   * @param {Uint8Array} code
   */
  delete (code) {
    if (this.code === undefined || this.address === -1) throw new Error('empty branch')
    const { match, matchingBits } = this.compare(code)
    if (match) {
      delete this.code
      delete this.address
      this.branches = []
    } else {
      const matchingBranch = this.branches[matchingBits]
      if (!matchingBranch) throw new Error('branch not found')
      matchingBranch.delete(code)
    }
  }

  compare (code) {
    const matchingBits = countMatchingBits(code.subarray(this.offset), this.code.subarray(this.offset))
    const matchingBytes = this.offset + Math.floor(matchingBits / 8)
    const match = matchingBytes === code.length && matchingBytes === this.code.length
    return { match, matchingBits, matchingBytes }
  }
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {number}
 */
export function countMatchingBits (a, b) {
  let bitCount = 0
  for (let i = 0; i < a.length && i < b.length; ++i) {
    const aByte = a.at(i)
    const bByte = b.at(i)
    let j = 0
    while (aByte >> j !== bByte >> j) ++j
    bitCount += 8 - j
    if (j) break
  }
  return bitCount
}
