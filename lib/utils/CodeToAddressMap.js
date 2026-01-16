export class CodeToAddressMap {
  /** @type {Array.<CodeToAddressMap>} */
  branches = []
  /**
   * @param {ArrayOfUint8Arrays} arrayOfUint8Arrays
   * @param {number} offset
   * @param {number} address
   */
  constructor (arrayOfUint8Arrays = new ArrayOfUint8Arrays(), offset = 0, address = -1) {
    this.arrayOfUint8Arrays = arrayOfUint8Arrays
    this.offset = offset
    this.address = address
  }

  get byteLength () {
    return this.arrayOfUint8Arrays.byteLength
  }

  /**
   * @param {ArrayOfUint8Arrays} arrayOfUint8Arrays
   */
  clone (arrayOfUint8Arrays = this.arrayOfUint8Arrays.cloneAt()) {
    const clone = new CodeToAddressMap(arrayOfUint8Arrays, this.offset, this.address)
    clone.code = this.code
    for (const index in this.branches) {
      const branch = this.branches[index]
      if (branch.address < clone.byteLength) clone.branches[index] = branch.clone(arrayOfUint8Arrays)
    }
    return clone
  }

  cloneAt (address) {
    return this.clone(this.arrayOfUint8Arrays.cloneAt(address))
  }

  /**
   * @param {number | Uint8Array} addressOrCode code or address
   * @returns {Uint8Array | number}
   */
  get (addressOrCode) {
    if (this.code === undefined || this.address === -1) return
    if (typeof addressOrCode === 'number') {
      const index = this.arrayOfUint8Arrays.byteIndexToIndex(addressOrCode)
      return this.arrayOfUint8Arrays.uint8ArrayInfos[index].uint8Array
    }
    const code = addressOrCode
    const matchingBitCount = countMatchingBits(code.subarray(this.offset), this.code.subarray(this.offset))
    const matchingByteCount = this.offset + Math.floor(matchingBitCount / 8)
    if (
      matchingByteCount === code.length &&
      matchingByteCount === this.code.length
    ) return this.address
    return this.branches[matchingBitCount]?.get?.(code)
  }

  /**
   * @param {Uint8Array} code
   * @param {number} address
   */
  set (code) {
    if (this.address === -1) {
      this.code = code
      this.arrayOfUint8Arrays.append(code)
      this.address = this.arrayOfUint8Arrays.byteLength - 1
      return this.address
    }
    const matchingBitCount = countMatchingBits(code.subarray(this.offset), this.code.subarray(this.offset))
    const matchingByteCount = this.offset + Math.floor(matchingBitCount / 8)
    if (
      matchingByteCount === code.length &&
      matchingByteCount === this.code.length
    ) throw new Error('setting an existing code/address is not allowed')
    if (!this.branches[matchingBitCount]) {
      this.branches[matchingBitCount] = new CodeToAddressMap(this.arrayOfUint8Arrays, this.offset + matchingByteCount)
    }
    return this.branches[matchingBitCount].set(code)
  }

  /**
   * @param {Uint8Array} code
   */
  delete (code) {
    if (this.code === undefined || this.address === undefined) throw new Error('empty branch')
    const matchingBitCount = countMatchingBits(code.subarray(this.offset), this.code.subarray(this.offset))
    const matchingByteCount = this.offset + Math.floor(matchingBitCount / 8)
    if (
      matchingByteCount === code.length &&
      matchingByteCount === this.code.length
    ) {
      delete this.code
      delete this.address
      this.branches = []
    } else {
      const matchingBranch = this.branches[matchingBitCount]
      if (!matchingBranch) throw new Error('branch not found')
      matchingBranch.delete(code)
    }
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

/**
 * @typedef {{uint8Array: Uint8Array, byteLength: number, index: number}} Uint8ArrayInfo
 */

export class ArrayOfUint8Arrays {
  /** @type {Array.<Uint8ArrayInfo>} */
  uint8ArrayInfos = []

  get byteLength () {
    const head = this.uint8ArrayInfos[this.uint8ArrayInfos.length - 1]
    return head?.byteLength || 0
  }

  cloneAt (byteIndex = this.byteLength - 1) {
    const clone = new ArrayOfUint8Arrays()
    const index = this.byteIndexToIndex(byteIndex)
    clone.uint8ArrayInfos = this.uint8ArrayInfos.slice(0, index + 1)
    return clone
  }

  /**
   * @param {Uint8Array} uint8Array
   */
  append (uint8Array) {
    if (!uint8Array.length) throw new Error('Uint8Array must have length > 0')
    const byteLength = this.byteLength + uint8Array.length
    this.uint8ArrayInfos.push({ uint8Array, byteLength, index: this.uint8ArrayInfos.length })
  }

  byteIndexToIndex (byteIndex) {
    let lowGuess = 0
    if (!this.uint8ArrayInfos.length) return
    if (isWithin(byteIndex, this.uint8ArrayInfos[lowGuess])) return lowGuess
    let highGuess = this.uint8ArrayInfos.length - 1
    if (!highGuess) return
    if (isWithin(byteIndex, this.uint8ArrayInfos[highGuess])) return highGuess
    let nextGuess
    while (
      (nextGuess = Math.floor((lowGuess + highGuess) / 2)) &&
      nextGuess !== lowGuess &&
      nextGuess !== highGuess
    ) {
      const uint8ArrayInfo = this.uint8ArrayInfos[nextGuess]
      if (isWithin(byteIndex, uint8ArrayInfo)) return nextGuess
      if (byteIndex >= uint8ArrayInfo.byteLength) lowGuess = nextGuess
      else highGuess = nextGuess
    }
  }

  byteAt (byteIndex) {
    const index = this.byteIndexToIndex(byteIndex)
    return atWithin(byteIndex, this.uint8ArrayInfos[index])
  }
}

/**
 * @param {number} byteIndex
 * @param {Uint8ArrayInfo} Uint8ArrayAndAddress
 * @returns {boolean}
 */
function isWithin (byteIndex, { uint8Array, byteLength }) {
  return byteIndex < byteLength && byteIndex >= byteLength - uint8Array.length
}

/**
 * @param {number} byteIndex
 * @param {Uint8ArrayInfo} uint8ArrayInfo
 * @returns {number}
 */
function atWithin (byteIndex, uint8ArrayInfo) {
  if (!uint8ArrayInfo) return
  const { uint8Array, byteLength } = uint8ArrayInfo
  const mappedIndex = uint8Array.length + (byteIndex - byteLength)
  return uint8Array[mappedIndex]
}
