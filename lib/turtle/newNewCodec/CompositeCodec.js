import { combineUint8ArrayLikes } from '../../utils/combineUint8ArrayLikes.js'
import { Addressifier } from './Addressifier.js'
import { Duple } from './Duple.js'
import { addressToBytes, bytesToAddress, range } from './utils.js'

/**
 * @typedef Codec
 * @property {string} type
 * @property {Array.<Array.<(code:Uint8Array)=>{type: string, width: number}} partReaders
 * @property {(code: Uint8Array) => number} getWidth
 * @property {(code: Uint8Array) => any} decode
 * @property {(value: any) => Array.<Uint8Array>} encode
 * @property {(code: Uint8Array) => object} inspect
 * @property {number} baseFooter
 */

export class CompositeCodec extends Addressifier {
  #inlinePart = [
    code => {
      const codec = this.#codeToCodec(code)
      const width = codec.getWidth(code)
      return { type: `(inline ${width}-byte array)`, width, code: code.slice(-width), codec }
    }
  ]

  #addressPart = range(4).map(i => code => {
    const width = i + 1
    const addressBytes = code.slice(-width)
    const address = bytesToAddress(addressBytes)
    const addressedCode = this.getCode(address)
    return { type: `(${width}-byte address)`, width, address, code: addressedCode }
  })

  #inlineOrAddressPart = [...this.#inlinePart, ...this.#addressPart]

  #literalPart = range(5).map(width => code => {
    const bytes = code.slice(-width)
    return { type: `(${width}-byte literal)`, width, code: bytes }
  })

  /** @type {Array.<Codec>} */
  #footerToCodec = []

  /** @type {Object.<string, Codec>} */
  #codecsByName = Object.fromEntries(Object.entries({
    undefined: {
      decode: () => undefined,
      encode: value => (value === undefined) && new Uint8Array([this.#codecsByName.undefined.baseFooter])
    },
    null: {
      decode: () => null,
      encode: value => (value === null) && new Uint8Array([this.#codecsByName.null.baseFooter])
    },
    false: {
      decode: () => false,
      encode: value => (value === false) && new Uint8Array([this.#codecsByName.false.baseFooter])
    },
    true: {
      decode: () => true,
      encode: value => (value === true) && new Uint8Array([this.#codecsByName.true.baseFooter])
    },
    emptyArray: {
      decode: () => ([]),
      encode: value => (Array.isArray(value)) && (value.length === 0) && new Uint8Array([this.#codecsByName.emptyArray.baseFooter])
    },
    Uint8Array_short: {
      partReaders: [this.#literalPart],
      decode: (code) => this.#decodeParts(code)[0].code,
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length <= 4) {
          return combineUint8ArrayLikes([uint8Array, this.#codecsByName.Uint8Array_short.baseFooter + uint8Array.length])
        }
      }
    },
    Uint8Array_long: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => combineUint8ArrayLikes(this.decode(this.#decodeParts(code)[0].code).flat()),
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length > 4) {
          const words = new Array(Math.ceil(uint8Array.length / 4))
          for (let i = 0; i < words.length; ++i) {
            words[i] = uint8Array.slice(i * 4, Math.min((i + 1) * 4, uint8Array.length))
          }
          return this.#encodeParts([new Duple(words)], this.#codecsByName.Uint8Array_long)
        }
      }
    },
    string: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => new TextDecoder().decode(this.decode(this.#decodeParts(code)[0].code)),
      encode: (string) => {
        if (typeof string === 'string') {
          const uint8Array = new TextEncoder().encode(string)
          return this.#encodeParts([uint8Array], this.#codecsByName.string)
        }
      }
    },
    float64: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => new Float64Array(this.decode(this.#decodeParts(code)[0].code).buffer)[0],
      encode: (float64) => {
        if (typeof float64 === 'number') {
          const uint8Array = new Uint8Array(new Float64Array([float64]).buffer)
          return this.#encodeParts([uint8Array], this.#codecsByName.float64)
        }
      }
    },
    duple: {
      partReaders: [this.#inlineOrAddressPart, this.#inlineOrAddressPart],
      decode: (code) => {
        const parts = this.#decodeParts(code)
        return new Duple([this.decode(parts[0].code), this.decode(parts[1].code)])
      },
      encode: (duple, refsOptions) => {
        if (!(duple instanceof Duple)) return
        return this.#encodeParts(duple.v, this.#codecsByName.duple)
      }
    },
    array: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => {
        console.log(code)
        const part = this.#decodeParts(code)[0]
        console.log(part)
        const arrayAsObject = this.decode(part.code)
        if (arrayAsObject instanceof Duple) return arrayAsObject.flat()
        return Object.assign([], arrayAsObject)
      },
      encode: (array) => {
        if (Array.isArray(array)) {
          if (array.length > 1 && Object.entries(array).length === array.length) {
            return this.#encodeParts([new Duple(array)], this.#codecsByName.array)
          } else {
            const arrayAsObject = Object.assign({}, array, { length: array.length })
            console.log(arrayAsObject)
            return this.#encodeParts([arrayAsObject], this.#codecsByName.array)
          }
        }
      }
    },
    emptyObject: {
      decode: () => ({}),
      encode: value => (typeof value === 'object') && (Object.entries(value).length === 0) && new Uint8Array([this.#codecsByName.emptyObject.baseFooter])
    },
    object: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => {
        console.log(this.decode(this.#decodeParts(code)[0].code))
        const flatDuples = this.decode(this.#decodeParts(code)[0].code).flatDuples()
        const entries = flatDuples.map(duple => [duple.v[0], duple.v[1]])
        return Object.fromEntries(entries)
      },
      encode: (object) => {
        if (typeof object === 'object') {
          const entriesAsDuples = Object.entries(object).map(([name, value]) => new Duple([name, value]))
          const objectAsDuple = entriesAsDuples.length === 1 ? entriesAsDuples[0] : new Duple(entriesAsDuples)
          return this.#encodeParts([objectAsDuple], this.#codecsByName.object)
        }
      }
    },
    variable: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => {
        const part = this.#decodeParts(code)[0]
        return this.decode(part.code)
        // this.decode(this.#decodeParts(code)[0].code)
      },
      encode: () => undefined,
      _encode: (codedValue) => {
        const [part, option] = this.#codeToPartAndOption(codedValue)
        return combineUint8ArrayLikes([part, option + this.#codecsByName.variable.baseFooter])
      }
    }
  }).map(([type, codec]) => {
    console.log(type)
    codec.type = type
    codec.baseFooter = this.#footerToCodec.length
    codec.getWidth ??= (code) => this.#decodeParts(code).reduce((sum, { width }) => sum + width, 1)
    codec.inspect ??= code => this.#basicInspect(code)
    const options = (codec.partReaders || []).reduce((sum, partReaderOptions) => sum * partReaderOptions.length, 1)
    for (let i = 0; i < options; ++i) {
      console.log(codec.type, codec.baseFooter, this.#footerToCodec.length)
      this.#footerToCodec.push(codec)
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
    console.group('decoding', codec.type, code)
    const value = codec.decode(code)
    console.groupEnd()
    console.log(value)
    return value
  }

  /**
   * @param {any} value
   * @param {RefsOptions} refsOptions
   * @returns {Uint8Array}
   */
  encode (value, refsOptions) {
    console.group('encoding', value)
    for (const type in this.#codecsByName) {
      const codec = this.#codecsByName[type]
      const code = codec.encode(value)
      if (code) {
        console.groupEnd()
        console.log(type, code)
        return code
      }
    }
  }

  encodeVariable (variable) {
    console.group('encodingVariable', variable)
    const code = this.encode(variable)
    const variableCode = this.#codecsByName.variable._encode(code)
    console.groupEnd()
    console.log('variable', variableCode)
    return variableCode
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
   * @returns {Array.<{type: string, width: number, code: Uint8Array, codec: Codec}>}
   */
  #decodeParts (code) {
    const footer = code.at(-1)
    const codec = this.#footerToCodec[footer]
    const parts = []
    if (codec.partReaders?.length) {
      let option = footer - codec.baseFooter
      let partEnd = -1
      for (const partReaderOptions of codec.partReaders.reverse()) {
        const partReader = partReaderOptions[option % partReaderOptions.length]
        option = Math.floor(option / partReaderOptions.length)
        console.group('decoding part', code.subarray(0, partEnd), partReader)
        const part = partReader(code.subarray(0, partEnd))
        console.log(part.type, part.code)
        console.groupEnd()
        partEnd -= part.width
        parts.unshift(part)
      }
    }
    return parts
  }

  /**
   * @param {Uint8Array} code
   * @returns {Codec}
   */
  #codeToCodec (code) {
    return this.#footerToCodec[code.at(-1)]
  }

  /**
   * @param {Uint8Array} code
   * @returns {number}
   */
  #codeToOption (code) {
    const footer = code.at(-1)
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
      const address = existingAddress ?? this.appendCode(codedValue)
      const addressBytes = addressToBytes(address)
      console.log(' - - - ', { codedValue, addressBytes, address })
      return [addressBytes, addressBytes.length]
    }
  }

  /**
   * @param {Array.<any>} values
   * @param {Codec} codec
   * @returns {Uint8Array}
   */
  #encodeParts (values, codec) {
    if (values.length !== codec.partReaders.length) throw new Error('must have same number of values as partReaders')
    const encodedParts = []
    let base = 1
    let footer = codec.baseFooter
    for (let i = values.length - 1; i >= 0; --i) {
      const value = values[i]
      console.group('encoding part', value)
      const [part, option] = this.#codeToPartAndOption(this.encode(value))
      console.log({ part, option })
      console.groupEnd()
      footer += base * option
      base *= codec.partReaders[i].length
      encodedParts.unshift(part)
    }
    // console.log(combineUint8ArrayLikes([...encodedParts, footer]))
    return combineUint8ArrayLikes([...encodedParts, footer])
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
      value: codec.decode(code),
      parts: this.#decodeParts(code).map(part => ({
        type: part.type,
        width: part.width,
        address: part.address,
        inspect: part.codec?.inspect?.(part.code)
      }))
    }
    return basic
  }
}
