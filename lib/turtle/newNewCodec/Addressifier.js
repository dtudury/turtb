import { combineUint8ArrayLikes } from '../../utils/combineUint8ArrayLikes.js'
import { combineUint8Arrays } from '../../utils/combineUint8Arrays.js'
import { CodeToAddressMap } from './CodeToAddressMap.js'

/**
 * @typedef OffsetUint8Array
 * @property {number} offset
 * @property {Uint8Array} uint8Array
 * @property {number} index
 */

export class Addressifier {
  /** @type {Array.<OffsetUint8Array>} */
  offsetUint8Arrays = []
  codeToAddressMap = new CodeToAddressMap()

  #resolveNextCode
  #setNextCode = code => {
    const prevResolve = this.#resolveNextCode
    this.nextCode = new Promise(resolve => { this.#resolveNextCode = resolve })
    prevResolve?.(code)
  }

  async * codeGenerator () {
    let lastIndex = -1
    while (true) {
      while (lastIndex < this.offsetUint8Arrays.length - 1) {
        yield this.offsetUint8Arrays[++lastIndex].uint8Array
      }
      await this.nextCode
    }
  }

  constructor () {
    this.#setNextCode()
  }

  /**
   * @returns {ReadableStream}
   */
  makeReadableStream () {
    let _controller
    const addressifier = this
    return new ReadableStream({
      async start (controller) {
        _controller = controller
        for await (const code of addressifier.codeGenerator()) {
          const encodedLength = new Uint32Array([code.length])
          _controller.enqueue(combineUint8ArrayLikes([encodedLength, code]))
        }
      },
      cancel (reason) {
        console.log('stream cancelled', { reason })
      },
      type: 'bytes'
    })
  }

  /**
   * @returns {WritableStream}
   */
  makeWritableStream () {
    let buffer = new Uint8Array()
    let u8aLength
    const addressifier = this
    return new WritableStream({
      write (chunk) {
        buffer = combineUint8Arrays([buffer, chunk])
        while (buffer.length > 4 && buffer.length > (u8aLength = new Uint32Array(buffer.slice(0, 4).buffer)[0])) {
          const code = buffer.slice(4, u8aLength + 4)
          addressifier.appendCode(code)
          buffer = buffer.slice(u8aLength + 4)
        }
      }
    })
  }

  get byteLength () {
    if (!this.offsetUint8Arrays.length) return 0
    const { offset, uint8Array } = this.offsetUint8Arrays[this.offsetUint8Arrays.length - 1]
    return offset + uint8Array.length
  }

  /**
   * @param {number} address
   * @returns {Addressifier}
   */
  clone (address) {
    const index = this.byteIndexToIndex(address)
    const addressifier = new Addressifier()
    addressifier.offsetUint8Array = this.offsetUint8Arrays.slice(0, index)
    addressifier.codeToAddressMap = this.codeToAddressMap.clone(address)
    return addressifier
  }

  /**
   * @param {Uint8Array} code
   * @returns {number}
   */
  appendCode (code) {
    if (!code.length) throw new Error('code must be Uint8Array with length > 0')
    if (this.codeToAddressMap.get(code)) throw new Error('code already exists')
    this.offsetUint8Arrays.push({ uint8Array: code, offset: this.byteLength, index: this.offsetUint8Arrays.length })
    const address = this.byteLength - 1
    this.codeToAddressMap.set(code, address)
    this.#setNextCode(code)
    return address
  }

  /**
   * @param {Uint8Array} code
   * @returns {number}
   */
  getCodeAddress (code) {
    return this.codeToAddressMap.get(code)
  }

  /**
   * @param {number} address
   * @param {boolean} strict
   * @returns {Uint8Array}
   */
  getCode (address, strict = true) {
    return this.getUint8ArrayAt(address, strict)
  }

  /**
   * @param {number} byteIndex
   * @param {boolean} strict
   * @returns {number}
   */
  byteIndexToIndex (byteIndex, strict = true) {
    let lowGuess = 0
    if (!this.offsetUint8Arrays.length) return
    if (isWithin(byteIndex, this.offsetUint8Arrays[lowGuess], strict)) return lowGuess
    let highGuess = this.offsetUint8Arrays.length - 1
    if (!highGuess) return
    if (isWithin(byteIndex, this.offsetUint8Arrays[highGuess], strict)) return highGuess
    let nextGuess
    while (
      (nextGuess = Math.floor((lowGuess + highGuess) / 2)) &&
      nextGuess !== lowGuess &&
      nextGuess !== highGuess
    ) {
      const offsetUint8Array = this.offsetUint8Arrays[nextGuess]
      if (isWithin(byteIndex, offsetUint8Array, strict)) return nextGuess
      if (byteIndex > offsetUint8Array.offset) lowGuess = nextGuess
      else highGuess = nextGuess
    }
  }

  /**
   * @param {number} byteIndex
   * @param {boolean} [strict=true]
   * @returns {Uint8Array}
   */
  getUint8ArrayAt (byteIndex = this.byteLength - 1, strict = true) {
    if (byteIndex === -1) return
    const index = this.byteIndexToIndex(byteIndex, strict)
    return this.offsetUint8Arrays[index].uint8Array
  }

  /**
   * @param {number} byteIndex
   * @returns {number}
   */
  byteAt (byteIndex) {
    const index = this.byteIndexToIndex(byteIndex, false)
    const offsetUint8Array = this.offsetUint8Arrays[index]
    if (!offsetUint8Array) return
    const { uint8Array, offset } = offsetUint8Array
    const mappedIndex = byteIndex - offset
    return uint8Array[mappedIndex]
  }

  /**
   * @param {number} [start=0]
   * @param {number} [end=this.byteLength]
   * @returns {Uint8Array}
   */
  slice (start = 0, end = this.byteLength) {
    const startIndex = this.byteIndexToIndex(start, false)
    const endIndex = (end === this.byteLength) ? this.offsetUint8Arrays.length - 1 : this.byteIndexToIndex(end, false)
    /** @type {OffsetUint8Array} */
    const { uint8Array: startU8a, offset: startOffset } = this.offsetUint8Arrays[startIndex]
    if (startIndex === endIndex) return startU8a.slice(start - startOffset, end - startOffset)
    if (end === this.byteLength) {
      return combineUint8ArrayLikes([
        startU8a.slice(start - startOffset),
        ...this.offsetUint8Arrays.slice(startIndex + 1).map(({ uint8Array }) => uint8Array)
      ])
    }
    /** @type {OffsetUint8Array} */
    const { uint8Array: endU8a, offset: endOffset } = this.offsetUint8Arrays[endIndex]
    return combineUint8ArrayLikes([
      startU8a.slice(start - startOffset),
      ...this.offsetUint8Arrays.slice(startIndex + 1, endIndex - 1).map(({ uint8Array }) => uint8Array),
      endU8a.slice(0, end - endOffset)
    ])
  }
}

/**
 * @param {number} byteIndex
 * @param {OffsetUint8Array}
 * @param {boolean} [strict=true]
 * @returns {boolean}
 */
function isWithin (byteIndex, { uint8Array, offset }, strict = true) {
  if (strict) return byteIndex === offset + uint8Array.length - 1
  return byteIndex < (offset + uint8Array.length) && byteIndex >= offset
}
