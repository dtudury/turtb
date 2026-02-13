import { combineUint8ArrayLikes } from '../../utils/combineUint8ArrayLikes.js'
import { Addressifier } from './Addressifier.js'
import { Duple } from './Duple.js'
import { Signature } from './Signature.js'
import { verifySignature } from './Signer.js'
import { addressToBytes, bytesToAddress, range } from './utils.js'

/**
 * @typedef {import('./Signer.js').Signer} Signer
 */

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
      return {
        type: `(inline ${width}-byte array)`,
        width,
        getCode: () => code.slice(-width),
        getDecoded: () => this.decode(code.slice(-width))
      }
    }
  ]

  #addressPart = range(4).map(i => code => {
    const width = i + 1
    const addressBytes = code.slice(-width)
    const address = bytesToAddress(addressBytes)
    return {
      type: `(${width}-byte address)`,
      width,
      address,
      getCode: () => this.getCode(address),
      getDecoded: () => this.decode(this.getCode(address))
    }
  })

  #wordPart = range(4).map(i => code => {
    const width = i + 1
    return {
      type: `(${width}-byte address)`,
      width,
      getDecoded: () => code.slice(-width)
    }
  })

  #inlineOrAddressPart = [...this.#inlinePart, ...this.#addressPart]

  #literalPart = range(5).map(width => code => ({
    type: `(${width}-byte literal)`,
    width,
    getDecoded: () => code.slice(-width)
  }))

  #signaturePart = [code => ({
    type: '(64-byte signature)',
    width: 64,
    getDecoded: () => code.slice(-64)
  })]

  #numberPart = range(128).map(number => () => ({
    type: `(${number} literal)`,
    width: 0,
    getDecoded: () => new Uint8Array([number])
  }))

  /** @type {Array.<Codec>} */
  #footerToCodec = []

  /** @type {Object.<string, Codec>} */
  #codecsByName = Object.fromEntries(Object.entries({
    UNDEFINED: {
      decode: () => undefined,
      encode: value => (value === undefined) && new Uint8Array([this.#codecsByName.UNDEFINED.baseFooter])
    },
    NULL: {
      decode: () => null,
      encode: value => (value === null) && new Uint8Array([this.#codecsByName.NULL.baseFooter])
    },
    FALSE: {
      decode: () => false,
      encode: value => (value === false) && new Uint8Array([this.#codecsByName.FALSE.baseFooter])
    },
    TRUE: {
      decode: () => true,
      encode: value => (value === true) && new Uint8Array([this.#codecsByName.TRUE.baseFooter])
    },
    WORD: {
      partReaders: [this.#literalPart],
      decode: (code) => this.#decodeParts(code)[0].getDecoded(),
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length <= 4) {
          return combineUint8ArrayLikes([uint8Array, this.#codecsByName.WORD.baseFooter + uint8Array.length])
        }
      }
    },
    UINT8ARRAY: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => combineUint8ArrayLikes(this.#decodeParts(code)[0].getDecoded().flat()),
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length > 4) {
          const words = new Array(Math.ceil(uint8Array.length / 4))
          for (let i = 0; i < words.length; ++i) {
            words[i] = uint8Array.slice(i * 4, Math.min((i + 1) * 4, uint8Array.length))
          }
          return this.#encodeInlineOrAddressParts([new Duple(words)], this.#codecsByName.UINT8ARRAY)
        }
      }
    },
    STRING: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => new TextDecoder().decode(this.#decodeParts(code)[0].getDecoded()),
      encode: (string) => {
        if (typeof string === 'string') {
          const uint8Array = new TextEncoder().encode(string)
          return this.#encodeInlineOrAddressParts([uint8Array], this.#codecsByName.STRING)
        }
      }
    },
    UINT7: {
      partReaders: [this.#numberPart],
      decode: (code) => {
        return this.#decodeParts(code)[0].getDecoded()[0]
      },
      encode: (number) => Number.isInteger(number) && number >= 0 && number < 128 && new Uint8Array([this.#codecsByName.UINT7.baseFooter + number])
    },
    FLOAT64: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => new Float64Array(this.#decodeParts(code)[0].getDecoded().buffer)[0],
      encode: (float64) => {
        if (typeof float64 === 'number') {
          const uint8Array = new Uint8Array(new Float64Array([float64]).buffer)
          return this.#encodeInlineOrAddressParts([uint8Array], this.#codecsByName.FLOAT64)
        }
      }
    },
    DATE: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => new Date(new Float64Array(this.#decodeParts(code)[0].getDecoded().buffer)[0]),
      encode: (date) => {
        if (date instanceof Date) {
          const uint8Array = new Uint8Array(new Float64Array([date.getTime()]).buffer)
          return this.#encodeInlineOrAddressParts([uint8Array], this.#codecsByName.DATE)
        }
      }
    },
    SIGNATURE: {
      partReaders: [this.#wordPart, this.#signaturePart],
      decode: (code) => {
        const parts = this.#decodeParts(code)
        return new Signature(bytesToAddress(parts[0].getDecoded()), parts[1].getDecoded())
      },
      encode: (signature) => {
        if (signature instanceof Signature) {
          const addressBytes = addressToBytes(signature.address)
          return combineUint8ArrayLikes([addressBytes, signature.compactRawBytes, this.#codecsByName.SIGNATURE.baseFooter + addressBytes.length - 1])
        }
      }
    },
    DUPLE: {
      partReaders: [this.#inlineOrAddressPart, this.#inlineOrAddressPart],
      decode: (code) => {
        const parts = this.#decodeParts(code)
        return new Duple([parts[0].getDecoded(), parts[1].getDecoded()])
      },
      encode: (duple, refsOptions) => {
        if (!(duple instanceof Duple)) return
        return this.#encodeInlineOrAddressParts(duple.v, this.#codecsByName.DUPLE)
      }
    },
    EMPTY_ARRAY: {
      decode: () => ([]),
      encode: array => (Array.isArray(array)) && (array.length === 0) && new Uint8Array([this.#codecsByName.EMPTY_ARRAY.baseFooter])
    },
    ARRAY: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => {
        const part = this.#decodeParts(code)[0]
        const arrayAsObject = part.getDecoded()
        if (arrayAsObject instanceof Duple) return arrayAsObject.flat()
        return Object.assign([], arrayAsObject)
      },
      encode: (array) => {
        if (Array.isArray(array)) {
          if (array.length > 1 && Object.entries(array).length === array.length) {
            return this.#encodeInlineOrAddressParts([new Duple(array)], this.#codecsByName.ARRAY)
          } else {
            const arrayAsObject = Object.assign({}, array, { length: array.length })
            return this.#encodeInlineOrAddressParts([arrayAsObject], this.#codecsByName.ARRAY)
          }
        }
      }
    },
    EMPTY_OBJECT: {
      decode: () => ({}),
      encode: object => (typeof object === 'object') && (Object.entries(object).length === 0) && new Uint8Array([this.#codecsByName.EMPTY_OBJECT.baseFooter])
    },
    OBJECT: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => {
        const flatDuples = this.#decodeParts(code)[0].getDecoded().flatDuples()
        const entries = flatDuples.map(duple => [duple.v[0], duple.v[1]])
        return Object.fromEntries(entries)
      },
      encode: (object) => {
        if (typeof object === 'object') {
          const entriesAsDuples = Object.entries(object).map(([name, value]) => new Duple([name, value]))
          const objectAsDuple = entriesAsDuples.length === 1 ? entriesAsDuples[0] : new Duple(entriesAsDuples)
          return this.#encodeInlineOrAddressParts([objectAsDuple], this.#codecsByName.OBJECT)
        }
      }
    },
    VARIABLE: {
      partReaders: [this.#inlineOrAddressPart],
      decode: (code) => {
        const part = this.#decodeParts(code)[0]
        return part.getDecoded()
      },
      encode: () => undefined,
      _encode: (codedValue) => {
        const [part, option] = this.#codeToInlineOrAddressPartAndOption(codedValue)
        return combineUint8ArrayLikes([part, option + this.#codecsByName.VARIABLE.baseFooter])
      }
    }
  }).map(([type, codec]) => {
    codec.type = type
    codec.baseFooter = this.#footerToCodec.length
    codec.getWidth ??= (code) => this.#decodeParts(code).reduce((sum, { width }) => sum + width, 1)
    codec.inspect ??= code => this.#basicInspect(code)
    const options = (codec.partReaders || []).reduce((sum, partReaderOptions) => sum * partReaderOptions.length, 1)
    for (let i = 0; i < options; ++i) {
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
    if (typeof code === 'number') return this.decode(this.getCode(code))
    if (!(code instanceof Uint8Array)) throw new Error('code must be Uint8Array')
    const codec = this.#codeToCodec(code)
    const value = codec.decode(code)
    return value
  }

  /**
   * @param {any} value
   * @param {RefsOptions} refsOptions
   * @returns {Uint8Array}
   */
  encode (value, refsOptions) {
    for (const type in this.#codecsByName) {
      const codec = this.#codecsByName[type]
      const code = codec.encode(value)
      if (code) {
        return code
      }
    }
  }

  encodeVariable (variable) {
    const code = this.encode(variable)
    const variableCode = this.#codecsByName.VARIABLE._encode(code)
    return variableCode
  }

  /**
   * @param {Uint8Array} code
   * @param {RefsOptions} refsOptions
   * @returns {any}
   */
  inspect (code, refsOptions) {
    const reports = []
    while (code.length) {
      const codec = this.#codeToCodec(code)
      const report = codec.inspect(code)
      reports[code.length - 1] = report
      code = code.subarray(0, -report.width)
    }
    return reports
  }

  #signedLength = 0
  /**
   * @param {Signer} signer
   * @returns {Signature}
   */
  async sign (signer, turtleName) {
    const oldByteLength = this.byteLength
    const uint8Array = this.slice(this.#signedLength, this.byteLength - 1)
    const compactRawBytes = await signer.sign(turtleName, uint8Array)
    if (this.byteLength !== oldByteLength) throw new Error('byteLength changed while signing')
    const signature = new Signature(this.#signedLength, compactRawBytes)
    const encodedSignature = this.#codecsByName.SIGNATURE.encode(signature)
    this.appendCode(encodedSignature)
    this.#signedLength = oldByteLength
    return signature
  }

  /**
   * @param {Signature} signature
   */
  async verify (signature, publicKey) {
    const { SIGNATURE } = this.#codecsByName
    const encodedSignature = SIGNATURE.encode(signature)
    const address = this.codeToAddressMap.get(encodedSignature)
    const width = SIGNATURE.getWidth(encodedSignature)
    const uint8Array = this.slice(signature.address, address - width)
    return verifySignature(publicKey, uint8Array, signature.compactRawBytes)
  }

  /**
   * @param {Uint8Array} code
   */
  appendCode (code) {
    let subArray = code
    const subcodes = []
    while (subArray.length) {
      const codec = this.#codeToCodec(subArray)
      const width = codec.getWidth(subArray)
      subcodes.unshift(subArray.subarray(-width))
      subArray = subArray.subarray(0, -width)
    }
    let lastCode = -1
    for (const subcode of subcodes) {
      lastCode = super.appendCode(subcode)
    }
    return lastCode
  }

  clone (address) {
    const index = this.byteIndexToIndex(address)
    const compositeCodec = new CompositeCodec()
    compositeCodec.offsetUint8Arrays = this.offsetUint8Arrays.slice(0, index + 1)
    compositeCodec.codeToAddressMap = this.codeToAddressMap.clone(address)
    compositeCodec.#signedLength = 0
    return compositeCodec
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
      for (let i = codec.partReaders.length - 1; i >= 0; --i) {
        const partReaderOptions = codec.partReaders[i]
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
  #codeToInlineOrAddressPartAndOption (codedValue) {
    const existingAddress = this.codeToAddressMap.get(codedValue)
    const nextAddress = Math.max(0, this.byteLength + codedValue.length - 1)
    if (!existingAddress && codedValue.length <= addressToBytes(nextAddress).length) {
      return [codedValue, 0]
    } else {
      const address = existingAddress ?? this.appendCode(codedValue)
      const addressBytes = addressToBytes(address)
      return [addressBytes, addressBytes.length]
    }
  }

  /**
   * @param {Array.<any>} values
   * @param {Codec} codec
   * @returns {Uint8Array}
   */
  #encodeInlineOrAddressParts (values, codec) {
    if (values.length !== codec.partReaders.length) throw new Error('must have same number of values as partReaders')
    const encodedParts = []
    let base = 1
    let footer = codec.baseFooter
    for (let i = values.length - 1; i >= 0; --i) {
      const value = values[i]
      const [part, option] = this.#codeToInlineOrAddressPartAndOption(this.encode(value))
      footer += base * option
      base *= codec.partReaders[i].length
      encodedParts.unshift(part)
    }
    return combineUint8ArrayLikes([...encodedParts, footer])
  }

  #basicInspect = (code, dereferences = 0) => {
    const codec = this.#codeToCodec(code)
    const option = this.#codeToOption(code)
    const basic = {
      type: codec.type,
      baseFooter: codec.baseFooter,
      option,
      footer: codec.baseFooter + option,
      width: codec.getWidth(code),
      parts: this.#decodeParts(code).map(part => {
        const report = {
          type: part.type,
          width: part.width,
          address: part.address
        }
        if (part.address) report.address = part.address
        if (part.getCode && dereferences > 0) {
          const code = part.getCode?.()
          const codec = this.#codeToCodec(code)
          report.report = codec.inspect(code, dereferences - 1)
        }
        return report
      })
    }
    return basic
  }
}
