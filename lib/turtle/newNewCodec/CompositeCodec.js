import { combineUint8ArrayLikes } from '../../utils/combineUint8ArrayLikes.js'
import { Addressifier } from './Addressifier.js'

/**
 * @typedef Codec
 * @property {string} type
 * @property {(code: Uint8Array) => number} getWidth
 * @property {(code: Uint8Array) => any} decode
 * @property {(value: any) => Array.<Uint8Array>} encode
 * @property {(code: Uint8Array) => object} inspect
 * @property {number} baseFooter
 */

export class CompositeCodec extends Addressifier {
  footerToCodec = []
  /** @type {Object.<string, Codec>} */
  codecsByName = Object.fromEntries(Object.entries({
    undefined: {
      decode: () => undefined,
      encode: value => (value === undefined) && new Uint8Array([this.codecsByName.undefined.baseFooter])
    },
    null: {
      decode: () => null,
      encode: value => (value === null) && new Uint8Array([this.codecsByName.null.baseFooter])
    },
    false: {
      decode: () => false,
      encode: value => (value === false) && new Uint8Array([this.codecsByName.false.baseFooter])
    },
    true: {
      decode: () => true,
      encode: value => (value === true) && new Uint8Array([this.codecsByName.true.baseFooter])
    },
    Uint8Array_short: {
      options: 5,
      getWidth: (code) => this.#codeToOption(code) + 1,
      decode: (code) => code.slice(-this.#codeToOption(code) - 1, -1),
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length <= 4) {
          return combineUint8ArrayLikes([uint8Array, this.codecsByName.Uint8Array_short.baseFooter + uint8Array.length])
        }
      }
    },
    Uint8Array_long: {
      options: 5,
      getWidth: (code) => 1 + (this.#codeToOption(code) || this.#getWidth(code.slice(0, -1))),
      decode: (code) => {
        const option = this.#codeToOption(code)
        const [v] = this.#readParts(code, [option])
        return combineUint8ArrayLikes(this.decode(v.code).flat())
      },
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length > 4) {
          const words = new Array(Math.ceil(uint8Array.length / 4))
          for (let i = 0; i < words.length; ++i) {
            words[i] = uint8Array.slice(i * 4, Math.min((i + 1) * 4, uint8Array.length))
          }
          const encodedDuple = this.encode(new Duple(words))
          console.log({ words, encodedDuple })
          const [part, option] = this.#codeToPartAndOption(encodedDuple)
          return combineUint8ArrayLikes([part, option + this.codecsByName.Uint8Array_long.baseFooter])
        }
      },
      inspect: (code) => {
        const option = this.#codeToOption(code)
        const basic = this.#basicInspect(code)
        basic.parts = this.#readParts(code, [option]).map(part => {
          const basic = this.inspect(part.code)
          return { address: part.address, offset: part.offset, ...basic }
        })
        return basic
      }
    },
    duple: {
      options: 25,
      getWidth: (code) => {
        const option = this.#codeToOption(code)
        const option0 = Math.floor(option / 5)
        const option1 = option % 5
        const [v0, v1] = this.#readParts(code, [option0, option1])
        return 1 + v0.width + v1.width
      },
      decode: (code) => {
        const option = this.#codeToOption(code)
        const option0 = Math.floor(option / 5)
        const option1 = option % 5
        const [v0, v1] = this.#readParts(code, [option0, option1])
        return new Duple([this.decode(v0.code), this.decode(v1.code)])
      },
      encode: (duple, refsOptions) => {
        if (!(duple instanceof Duple)) return
        const [part0, option0] = this.#codeToPartAndOption(this.encode(duple.v[0], refsOptions))
        const [part1, option1] = this.#codeToPartAndOption(this.encode(duple.v[1], refsOptions))
        const footer = this.codecsByName.duple.baseFooter + option0 * 5 + option1
        return combineUint8ArrayLikes([part0, part1, footer])
      },
      inspect: (code) => {
        const option = this.#codeToOption(code)
        const option0 = Math.floor(option / 5)
        const option1 = option % 5
        const basic = this.#basicInspect(code)
        basic.parts = this.#readParts(code, [option0, option1]).map(part => {
          const basic = this.inspect(part.code)
          return { address: part.address, offset: part.offset, ...basic }
        })
        return basic
      }
    },
    variable: {
      options: 5,
      getWidth: (code) => 1 + (this.#codeToOption(code) || this.#getWidth(code.slice(0, -1))),
      decode: (code) => {
        const option = this.#codeToOption(code)
        const [v] = this.#readParts(code, [option])
        return this.decode(v.code)
      },
      encode: () => undefined,
      _encode: (codedValue) => {
        const [part, option] = this.#codeToPartAndOption(codedValue)
        return combineUint8ArrayLikes([part, option + this.codecsByName.variable.baseFooter])
      },
      inspect: (code) => {
        const option = this.#codeToOption(code)
        const basic = this.#basicInspect(code)
        basic.parts = this.#readParts(code, [option]).map(part => {
          const basic = this.inspect(part.code)
          return { address: part.address, offset: part.offset, ...basic }
        })
        return basic
      }
    }
  }).map(([type, codec]) => {
    console.log(type)
    codec.type = type
    codec.baseFooter = this.footerToCodec.length
    codec.getWidth ??= () => 1
    codec.inspect ??= code => this.#basicInspect(code)
    for (let i = 0; i < (codec.options || 1); ++i) {
      this.footerToCodec.push(codec)
    }
    return [type, codec]
  }))

  /**
   * @param {Uint8Array} code
   * @param {RefsOptions} refsOptions
   * @returns {any}
   */
  decode (code, refsOptions) {
    const codec = this.#codeToCodec(code)
    return codec.decode(code)
  }

  /**
   * @param {any} value
   * @param {RefsOptions} refsOptions
   * @returns {Uint8Array}
   */
  encode (value, refsOptions) {
    for (const type in this.codecsByName) {
      const codec = this.codecsByName[type]
      const code = codec.encode(value)
      if (code) return code
    }
  }

  encodeVariable (variable) {
    const code = this.encode(variable)
    return this.codecsByName.variable._encode(code)
  }

  /**
   * @param {Uint8Array} code
   * @param {RefsOptions} refsOptions
   * @returns {any}
   */
  inspect (code, refsOptions) {
    const codec = this.#codeToCodec(code)
    return codec.inspect(code)
  }

  #getWidth (code) {
    const codec = this.#codeToCodec(code)
    return codec.getWidth(code)
  }

  /**
   * @param {Uint8Array} code
   * @returns {Codec}
   */
  #codeToCodec (code) {
    const footer = code.at(code.length - 1)
    return this.footerToCodec[footer]
  }

  /**
   * @param {Uint8Array} code
   * @returns {number}
   */
  #codeToOption (code) {
    const footer = code.at(code.length - 1)
    const codec = this.#codeToCodec(code)
    return footer - codec.baseFooter
  }

  /**
   * @param {Uint8Array} code
   * @returns {[Uint8Array, number]}
   */
  #codeToPartAndOption (codedValue) {
    const existingAddress = this.codeToAddressMap.get(codedValue)
    const nextAddress = Math.max(0, this.byteLength + codedValue.length - 1)
    if (!existingAddress && codedValue.length <= addressToBytes(nextAddress).length) {
      return [codedValue, 0]
    } else {
      const addressBytes = addressToBytes(existingAddress ?? this.appendCode(codedValue))
      return [addressBytes, addressBytes.length]
    }
  }

  #readParts (codedValue, options) {
    let offset = -1
    const parts = []
    for (const option of options.reverse()) {
      let code, width, address
      if (option === 0) {
        code = codedValue.slice(0, offset)
        width = this.#getWidth(code)
      } else {
        width = option
        address = bytesToAddress(codedValue.slice(offset - width, offset))
        code = this.getUint8ArrayAt(address)
      }
      parts.unshift({ code, address, width, offset })
      offset -= width
    }
    return parts
  }

  #basicInspect = (code) => {
    const codec = this.#codeToCodec(code)
    return {
      type: codec.type,
      baseFooter: codec.baseFooter,
      option: this.#codeToOption(code),
      footer: codec.baseFooter + this.#codeToOption(code),
      width: codec.getWidth(code),
      value: codec.decode(code)?.toString?.()
    }
  }
}

export class Duple {
  /**
   * @param {Array.<any>} v
   */
  constructor (v) {
    if (v.length === 2) {
      this.v = v
    } else if (v.length > 2) {
      const leftLength = 2 ** (31 - Math.clz32(v.length - 1))
      this.v = []
      this.v.push(new Duple(v.slice(0, leftLength)))
      if (leftLength === v.length - 1) this.v.push(v[v.length - 1])
      else this.v.push(new Duple(v.slice(leftLength)))
    } else {
      throw new Error('unhandled array length')
    }
  }

  flat () {
    return [
      this.v[0]?.flat?.() || this.v[0],
      this.v[1]?.flat?.() || this.v[1]
    ].flat()
  }
}

function addressToBytes (address) {
  if (address < 0) throw new Error('address must not be negative')
  if (!address) return new Uint8Array([0])
  const bytes = []
  while (address) {
    bytes.push(address & 0xff)
    address >>= 8
  }
  return bytes
}

function bytesToAddress (bytes) {
  let address = 0
  bytes.reverse().forEach(byte => {
    address = (address << 8) | byte
  })
  return address
}
