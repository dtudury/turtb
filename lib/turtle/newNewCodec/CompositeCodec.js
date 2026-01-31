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
  inlinePart = [
    code => {
      const codec = this.#codeToCodec(code)
      const width = codec.getWidth(code)
      return { type: `(inline ${width}-byte array)`, width, code: code.slice(-width), codec }
    }
  ]

  addressPart = range(4).map(i => code => {
    const width = i + 1
    const addressBytes = code.slice(-width)
    const address = bytesToAddress(addressBytes)
    const addressedCode = this.getCode(address)
    const codec = this.#codeToCodec(addressedCode)
    return { type: `(${width}-byte address)`, width, address, code: addressedCode, codec }
  })

  inlineOrAddressPart = [...this.inlinePart, ...this.addressPart]

  literalPart = range(5).map(width => code => {
    const bytes = code.slice(-width)
    return { type: `(${width}-byte literal)`, width, code: bytes }
  })
  /** @type {Array.<Codec>} */

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
      partReaders: [this.literalPart],
      decode: (code) => this.codeToParts(code)[0].code,
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length <= 4) {
          return combineUint8ArrayLikes([uint8Array, this.codecsByName.Uint8Array_short.baseFooter + uint8Array.length])
        }
      }
    },
    Uint8Array_long: {
      partReaders: [this.inlineOrAddressPart],
      decode: (code) => combineUint8ArrayLikes(this.decode(this.codeToParts(code)[0].code).flat()),
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length > 4) {
          const words = new Array(Math.ceil(uint8Array.length / 4))
          for (let i = 0; i < words.length; ++i) {
            words[i] = uint8Array.slice(i * 4, Math.min((i + 1) * 4, uint8Array.length))
          }
          const encodedDuple = this.encode(new Duple(words))
          const [part, option] = this.#codeToPartAndOption(encodedDuple)
          return combineUint8ArrayLikes([part, option + this.codecsByName.Uint8Array_long.baseFooter])
        }
      }
    },
    string: {
      partReaders: [this.inlineOrAddressPart],
      decode: (code) => new TextDecoder().decode(this.decode(this.codeToParts(code)[0].code)),
      encode: (string) => {
        if (typeof string === 'string') {
          const uint8Array = new TextEncoder().encode(string)
          const encodedBytes = this.encode(uint8Array)
          const [part, option] = this.#codeToPartAndOption(encodedBytes)
          return combineUint8ArrayLikes([part, option + this.codecsByName.string.baseFooter])
        }
      }
    },
    float64: {
      partReaders: [this.inlineOrAddressPart],
      decode: (code) => new Float64Array(this.decode(this.codeToParts(code)[0].code).buffer)[0],
      encode: (float64) => {
        if (typeof float64 === 'number') {
          const uint8Array = new Uint8Array(new Float64Array([float64]).buffer)
          const encodedBytes = this.encode(uint8Array)
          const [part, option] = this.#codeToPartAndOption(encodedBytes)
          return combineUint8ArrayLikes([part, option + this.codecsByName.float64.baseFooter])
        }
      }
    },
    duple: {
      partReaders: [this.inlineOrAddressPart, this.inlineOrAddressPart],
      decode: (code) => {
        const parts = this.codeToParts(code)
        return new Duple([this.decode(parts[0].code), this.decode(parts[1].code)])
      },
      encode: (duple, refsOptions) => {
        if (!(duple instanceof Duple)) return
        const [part0, option0] = this.#codeToPartAndOption(this.encode(duple.v[0], refsOptions))
        const [part1, option1] = this.#codeToPartAndOption(this.encode(duple.v[1], refsOptions))
        const footer = this.codecsByName.duple.baseFooter + option0 * 5 + option1
        return combineUint8ArrayLikes([part0, part1, footer])
      }
    },
    array: {
      partReaders: [this.inlineOrAddressPart],
      decode: (code) => {
        const arrayAsObject = this.decode(this.codeToParts(code)[0].code)
        if (arrayAsObject instanceof Duple) return arrayAsObject.flat()
        return Object.assign([], arrayAsObject)
      },
      encode: (array) => {
        if (Array.isArray(array)) {
          if (array.length > 1 && Object.entries(array).length === array.length) {
            const encodedBytes = this.encode(new Duple(array))
            const [part, option] = this.#codeToPartAndOption(encodedBytes)
            return combineUint8ArrayLikes([part, option + this.codecsByName.array.baseFooter])
          } else {
            const arrayAsObject = Object.assign({}, array, { length: array.length })
            const encodedBytes = this.encode(arrayAsObject)
            const [part, option] = this.#codeToPartAndOption(encodedBytes)
            return combineUint8ArrayLikes([part, option + this.codecsByName.array.baseFooter])
          }
        }
      }
    },
    emptyObject: {
      decode: () => ({}),
      encode: value => (typeof value === 'object') && (Object.entries(value).length === 0) && new Uint8Array([this.codecsByName.emptyObject.baseFooter])
    },
    object: {
      partReaders: [this.inlineOrAddressPart],
      decode: (code) => {
        const flatDuples = this.decode(this.codeToParts(code)[0].code).flatDuples()
        const entries = flatDuples.map(duple => [duple.v[0], duple.v[1]])
        return Object.fromEntries(entries)
      },
      encode: (object) => {
        if (typeof object === 'object') {
          const entriesAsDuples = Object.entries(object).map(([name, value]) => new Duple([name, value]))
          const objectAsDuple = entriesAsDuples.length === 1 ? entriesAsDuples[0] : new Duple(entriesAsDuples)
          const encodedBytes = this.encode(objectAsDuple)
          const [part, option] = this.#codeToPartAndOption(encodedBytes)
          return combineUint8ArrayLikes([part, option + this.codecsByName.object.baseFooter])
        }
      }
    },
    variable: {
      partReaders: [this.inlineOrAddressPart],
      decode: (code) => this.decode(this.codeToParts(code)[0].code),
      encode: () => undefined,
      _encode: (codedValue) => {
        const [part, option] = this.#codeToPartAndOption(codedValue)
        return combineUint8ArrayLikes([part, option + this.codecsByName.variable.baseFooter])
      }
    }
  }).map(([type, codec]) => {
    console.log(type)
    codec.type = type
    codec.baseFooter = this.footerToCodec.length
    codec.getWidth ??= (code) => this.codeToParts(code).reduce((sum, { width }) => sum + width, 1)
    codec.inspect ??= code => this.#basicInspect(code)
    const options = (codec.partReaders || []).reduce((sum, partReaderOptions) => sum + partReaderOptions.length, 1)
    for (let i = 0; i < options; ++i) {
      this.footerToCodec.push(codec)
    }
    return [type, codec]
  }))

  /**
   * @param {Uint8Array} code
   * @returns {Array.<{type: string, width: number, code: Uint8Array, codec: Codec}>}
   */
  codeToParts (code) {
    const footer = code.at(code.length - 1)
    const codec = this.footerToCodec[footer]
    const parts = []
    if (codec.partReaders?.length) {
      let option = footer - codec.baseFooter
      let partEnd = -1
      for (const partReaderOptions of codec.partReaders.reverse()) {
        const partReader = partReaderOptions[option % partReaderOptions.length]
        option = Math.floor(option / partReaderOptions.length)
        const part = partReader(code.subarray(0, partEnd))
        partEnd -= part.width
        parts.unshift(part)
      }
    }
    return parts
  }

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

  #basicInspect = (code, partsOptions) => {
    const codec = this.#codeToCodec(code)
    const option = this.#codeToOption(code)
    const basic = {
      type: codec.type,
      baseFooter: codec.baseFooter,
      option,
      footer: codec.baseFooter + option,
      width: codec.getWidth(code),
      value: codec.decode(code)?.toString?.(),
      parts: this.codeToParts(code).map(part => ({
        inspect: part.codec?.inspect?.(part.code),
        ...part
      }))
    }
    return basic
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
      (this.v[0] instanceof Duple) ? this.v[0].flat() : this.v[0],
      (this.v[1] instanceof Duple) ? this.v[1].flat() : this.v[1]
    ].flat()
  }

  flatDuples () {
    if (this.v.every(v => (v instanceof Duple))) {
      return [this.v[0].flatDuples(), this.v[1].flatDuples()].flat()
    } else if (this.v.every(v => !(v instanceof Duple))) {
      return [this]
    } else {
      throw new Error('non flattable duple')
    }
  }

  toString () {
    return '[object Duple]'
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

function range (length) {
  return Array.from({ length }, (_, n) => n)
}
