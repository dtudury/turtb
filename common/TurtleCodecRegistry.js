import { combineUint8ArrayLikes } from './utils/combineUint8ArrayLikes.js'
import { Addressifier } from './Addressifier.js'
import { Commit } from './Commit.js'
import { Duple } from './Duple.js'
import { Signature } from './Signature.js'
import { numberToVar, VarToNumber, range } from './utils.js'

/**
 * information about a sub-value and how it is encoded
 * @typedef PartReport
 * @property {string} type
 * @property {number} width
 * @property {number} [address] - present when the part is stored by reference
 * @property {InspectionReport} [report] - present when dereferences > 0
 */

/**
 * information about how the value is encoded
 * @typedef InspectionReport
 * @property {string} type
 * @property {number} option - which partReader option was chosen (offset from baseFooter)
 * @property {number} footer - baseFooter + option
 * @property {number} baseFooter
 * @property {number} width
 * @property {Array.<PartReport>} parts
 */

/**
 * @typedef PartReader
 * @property {string} type
 * @property {number} width
 * @property {number} [address] - present when the part is stored by reference
 * @property {function(): Uint8Array} [getCode] - present when the part has retrievable code
 * @property {function(asRefs: boolean|Array.<boolean>): any} getDecoded
 */

/**
 * @typedef Codec
 * @property {string} type
 * @property {Array.<Array.<function(code:Uint8Array): PartReader>>} [partReaders]
 * @property {(code: Uint8Array) => number} getWidth
 * @property {(code: Uint8Array, dereferences?: number) => InspectionReport} inspect
 * @property {(code: Uint8Array, asRefs?: boolean|Array.<boolean>) => any} decode
 * @property {(value: any, asRefs?: boolean|Array.<boolean>) => Uint8Array|false|undefined} encode
 * @property {number} baseFooter
 */

/**
 * An append-only, content-addressable store with a built-in codec system.
 *
 * Each value is encoded as a Uint8Array whose last byte (the "footer") identifies
 * its codec type. Footers are allocated sequentially as codecs register, so the
 * footer value doubles as a type tag. Multi-part values (objects, arrays, strings,
 * etc.) reference sub-values either inline or by address — whichever is more
 * compact — with the footer encoding which option was chosen for each part.
 *
 * Because encoding is deterministic, the same value always produces the same bytes
 * and therefore always lands at the same address (deduplication via CodeToAddressMap).
 * Address equality implies value equality.
 */
export class TurtleCodecRegistry extends Addressifier {
  /** @type {Array.<Codec>} */
  #footerToCodec = []

  /**
   * Returns the code for a given address. Negative addresses encode single-byte
   * (primitive) values: address = -(footer + 1), so footer = -address - 1.
   * This gives UNDEFINED, NULL, FALSE, TRUE, and every UINT7 value a stable
   * address without requiring them to be appended to the store.
   * @param {number} address
   * @param {boolean} [strict=true]
   * @returns {Uint8Array}
   */
  getCode (address, strict = true) {
    if (typeof address === 'number' && address < 0) {
      return new Uint8Array([-address - 1])
    }
    return super.getCode(address, strict)
  }

  /**
   * Decodes the parts of a coded value using its codec's partReaders.
   * The footer encodes both the codec type and which partReader option was chosen
   * for each part (packed as a mixed-radix number offset from baseFooter).
   * @param {Uint8Array} code
   * @returns {Array.<PartReader>}
   */
  #decodeParts (code) {
    const footer = code.at(-1)
    if (footer === undefined) return []
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
   * @param {Uint8Array} codedValue
   * @returns {[Uint8Array, number]}
   */
  #codeToInlineOrAddressPartAndOption (codedValue) {
    const existingAddress = this.codeToAddressMap.get(codedValue)
    const nextAddress = Math.max(0, this.byteLength + codedValue.length - 1)
    if (!existingAddress && codedValue.length <= numberToVar(nextAddress).length) {
      return [codedValue, 0]
    } else {
      const address = existingAddress ?? this.appendCode(codedValue)
      const addressVar = numberToVar(address)
      return [addressVar, addressVar.length]
    }
  }

  /**
   * @param {Array.<any>} values
   * @param {Codec} codec
   * @param {boolean|Array.<boolean>} [asRefs]
   * @returns {Uint8Array}
   */
  #encodeInlineOrAddressParts (values, codec, asRefs) {
    if (values.length !== codec.partReaders.length) throw new Error('must have same number of values as partReaders')
    const encodedParts = []
    let base = 1
    let footer = codec.baseFooter
    for (let i = values.length - 1; i >= 0; --i) {
      const value = values[i]
      const [part, option] = this.#codeToInlineOrAddressPartAndOption(this.encode(value, asRefs))
      footer += base * option
      base *= codec.partReaders[i].length
      encodedParts.unshift(part)
    }
    return combineUint8ArrayLikes([...encodedParts, footer])
  }

  /**
   * @param {Uint8Array} code
   * @param {number} [dereferences=0]
   * @returns {InspectionReport}
   */
  #basicInspect (code, dereferences = 0) {
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
          width: part.width
        }
        if (part.address) report.address = part.address
        if (part.getCode && dereferences > 0) {
          const code = part.getCode()
          const codec = this.#codeToCodec(code)
          report.report = codec.inspect(code, dereferences - 1)
        }
        return report
      })
    }
    return basic
  }

  /** @type {Array.<PartReader>} */
  #inlinePartReaders = [
    code => {
      const codec = this.#codeToCodec(code)
      const width = codec.getWidth(code)
      return {
        type: `(inline ${width}-byte array)`,
        width,
        getCode: () => code.slice(-width),
        getDecoded: (asRefs) => this.decode(code.slice(-width), asRefs)
      }
    }
  ]

  /** @type {Array.<PartReader>} */
  #addressPartReaders = range(4).map(i => code => {
    const width = i + 1
    const addressBytes = code.slice(-width)
    const address = VarToNumber(addressBytes)
    return {
      type: `(${width}-byte address)`,
      width,
      address,
      getCode: () => this.getCode(address),
      getDecoded: (asRefs) => this.decode(this.getCode(address), asRefs)
    }
  })

  /** @type {Array.<PartReader>} */
  #wordPartReaders = range(4).map(i => code => {
    const width = i + 1
    return {
      type: `(${width}-byte address)`,
      width,
      getDecoded: () => code.slice(-width)
    }
  })

  /** @type {Array.<PartReader>} */
  #inlineOrAddressPartReaders = [...this.#inlinePartReaders, ...this.#addressPartReaders]

  /** @type {Array.<PartReader>} */
  #literalPartReaders = range(5).map(width => code => ({
    type: `(${width}-byte literal)`,
    width,
    getDecoded: () => code.slice(-width)
  }))

  /** @type {Array.<PartReader>} */
  #signaturePartReaders = [code => ({
    type: '(64-byte signature)',
    width: 64,
    getDecoded: () => code.slice(-64)
  })]

  /** @type {Array.<PartReader>} */
  #numberPartReaders = range(128).map(number => () => ({
    type: `(${number} literal)`,
    width: 0,
    getDecoded: () => new Uint8Array([number])
  }))

  /** @type {function([string, Codec]): [string, Codec]} */
  #registerCompletedCodecs = ([type, codec]) => {
    codec.type = type
    codec.baseFooter = this.#footerToCodec.length
    codec.getWidth ??= (code) => this.#decodeParts(code).reduce((sum, { width }) => sum + width, 1)
    codec.inspect ??= (code, dereferences) => this.#basicInspect(code, dereferences)
    const options = (codec.partReaders || []).reduce((sum, partReaderOptions) => sum * partReaderOptions.length, 1)
    for (let i = 0; i < options; ++i) {
      this.#footerToCodec.push(codec)
    }
    return [type, codec]
  }

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
      partReaders: [this.#literalPartReaders],
      decode: (code) => this.#decodeParts(code)[0].getDecoded(),
      encode: (uint8Array) => {
        if (uint8Array instanceof Uint8Array && uint8Array.length <= 4) {
          return combineUint8ArrayLikes([uint8Array, this.#codecsByName.WORD.baseFooter + uint8Array.length])
        }
      }
    },
    UINT8ARRAY: {
      partReaders: [this.#inlineOrAddressPartReaders],
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
      partReaders: [this.#inlineOrAddressPartReaders],
      decode: (code) => new TextDecoder().decode(this.#decodeParts(code)[0].getDecoded()),
      encode: (string) => {
        if (typeof string === 'string') {
          const uint8Array = new TextEncoder().encode(string)
          return this.#encodeInlineOrAddressParts([uint8Array], this.#codecsByName.STRING)
        }
      }
    },
    UINT7: {
      partReaders: [this.#numberPartReaders],
      decode: (code) => {
        return this.#decodeParts(code)[0].getDecoded()[0]
      },
      encode: (number) => Number.isInteger(number) && number >= 0 && number < 128 && new Uint8Array([this.#codecsByName.UINT7.baseFooter + number])
    },
    FLOAT64: {
      partReaders: [this.#inlineOrAddressPartReaders],
      decode: (code) => new Float64Array(this.#decodeParts(code)[0].getDecoded().buffer)[0],
      encode: (float64) => {
        if (typeof float64 === 'number') {
          const uint8Array = new Uint8Array(new Float64Array([float64]).buffer)
          return this.#encodeInlineOrAddressParts([uint8Array], this.#codecsByName.FLOAT64)
        }
      }
    },
    DATE: {
      partReaders: [this.#inlineOrAddressPartReaders],
      decode: (code) => new Date(new Float64Array(this.#decodeParts(code)[0].getDecoded().buffer)[0]),
      encode: (date) => {
        if (date instanceof Date) {
          const uint8Array = new Uint8Array(new Float64Array([date.getTime()]).buffer)
          return this.#encodeInlineOrAddressParts([uint8Array], this.#codecsByName.DATE)
        }
      }
    },
    SIGNATURE: {
      partReaders: [this.#wordPartReaders, this.#signaturePartReaders],
      decode: (code) => {
        const parts = this.#decodeParts(code)
        return new Signature(VarToNumber(parts[0].getDecoded()), parts[1].getDecoded())
      },
      encode: (signature) => {
        if (signature instanceof Signature) {
          const addressVar = numberToVar(signature.address)
          return combineUint8ArrayLikes([addressVar, signature.compactRawBytes, this.#codecsByName.SIGNATURE.baseFooter + addressVar.length - 1])
        }
      }
    },
    COMMIT: {
      partReaders: [this.#wordPartReaders],
      decode: (code) => {
        const parts = this.#decodeParts(code)
        const lengthVar = parts[0].getDecoded()
        const length = VarToNumber(lengthVar)
        return new Commit(code.slice(-1 - lengthVar.length - length, -1 - lengthVar.length))
      },
      getWidth: (code) => {
        const parts = this.#decodeParts(code)
        const lengthVar = parts[0].getDecoded()
        const length = VarToNumber(lengthVar)
        return length + lengthVar.length + 1
      },
      encode: (commit) => {
        if (commit instanceof Commit) {
          const lengthVar = numberToVar(commit.uint8Array.length)
          return combineUint8ArrayLikes([commit.uint8Array, lengthVar, this.#codecsByName.COMMIT.baseFooter + lengthVar.length - 1])
        }
      }
    },
    DUPLE: {
      partReaders: [this.#inlineOrAddressPartReaders, this.#inlineOrAddressPartReaders],
      decode: (code, asRefs) => {
        const parts = this.#decodeParts(code)
        const getAddress = part => {
          if (part.address !== undefined) return part.address
          const code = part.getCode()
          if (code.length === 1) return -(code[0] + 1)
          return this.codeToAddressMap.get(code) ?? this.appendCode(code)
        }
        const part0IsLeaf = this.#codeToCodec(parts[0].getCode()).type !== 'DUPLE'
        const part1IsLeaf = this.#codeToCodec(parts[1].getCode()).type !== 'DUPLE'
        if (part0IsLeaf && part1IsLeaf) {
          const nameIsRef = Array.isArray(asRefs) && asRefs[1]
          const valueIsRef = asRefs === true || (Array.isArray(asRefs) && asRefs[0])
          return new Duple([
            nameIsRef ? getAddress(parts[0]) : parts[0].getDecoded(false),
            valueIsRef ? getAddress(parts[1]) : parts[1].getDecoded(false)
          ])
        } else {
          return new Duple([parts[0].getDecoded(asRefs), parts[1].getDecoded(asRefs)])
        }
      },
      encode: (duple, asRefs) => {
        if (!(duple instanceof Duple)) return
        return this.#encodeInlineOrAddressParts(duple.v, this.#codecsByName.DUPLE, asRefs)
      }
    },
    EMPTY_ARRAY: {
      decode: () => ([]),
      encode: array => (Array.isArray(array)) && (array.length === 0) && new Uint8Array([this.#codecsByName.EMPTY_ARRAY.baseFooter])
    },
    ARRAY: {
      partReaders: [this.#inlineOrAddressPartReaders],
      decode: (code, asRefs) => {
        const part = this.#decodeParts(code)[0]
        const arrayAsObject = part.getDecoded(asRefs)
        if (arrayAsObject instanceof Duple) return arrayAsObject.flat()
        return Object.assign([], arrayAsObject)
      },
      encode: (array, asRefs) => {
        if (Array.isArray(array)) {
          if (array.length > 1 && Object.entries(array).length === array.length) {
            return this.#encodeInlineOrAddressParts([new Duple(array)], this.#codecsByName.ARRAY, asRefs)
          } else {
            const arrayAsObject = Object.assign({}, array, { length: array.length })
            return this.#encodeInlineOrAddressParts([arrayAsObject], this.#codecsByName.ARRAY, asRefs)
          }
        }
      }
    },
    EMPTY_OBJECT: {
      decode: () => ({}),
      encode: object => (typeof object === 'object') && (Object.entries(object).length === 0) && new Uint8Array([this.#codecsByName.EMPTY_OBJECT.baseFooter])
    },
    OBJECT: {
      partReaders: [this.#inlineOrAddressPartReaders],
      decode: (code, asRefs) => {
        const flatDuples = this.#decodeParts(code)[0].getDecoded(asRefs).flatDuples()
        const entries = flatDuples.map(duple => [duple.v[0], duple.v[1]])
        return Object.fromEntries(entries)
      },
      encode: (object, asRefs) => {
        if (typeof object === 'object') {
          const entriesAsDuples = Object.entries(object).map(([name, value]) => new Duple([name, value]))
          const objectAsDuple = entriesAsDuples.length === 1 ? entriesAsDuples[0] : new Duple(entriesAsDuples)
          return this.#encodeInlineOrAddressParts([objectAsDuple], this.#codecsByName.OBJECT, asRefs)
        }
      }
    },
    VARIABLE: {
      partReaders: [this.#inlineOrAddressPartReaders],
      decode: (code, asRefs) => {
        const part = this.#decodeParts(code)[0]
        return part.getDecoded(asRefs)
      },
      encode: () => undefined,
      _encode: (codedValue, asRefs) => {
        const [part, option] = this.#codeToInlineOrAddressPartAndOption(codedValue, asRefs)
        return combineUint8ArrayLikes([part, option + this.#codecsByName.VARIABLE.baseFooter])
      }
    }
  }).map(this.#registerCompletedCodecs))

  /**
   * @param {Uint8Array | number} code
   * @param {boolean|Array.<boolean>} [asRefs=false]
   * @returns {any}
   */
  decode (code, asRefs = false) {
    if (code === undefined || typeof code === 'number') return this.decode(this.getCode(code), asRefs)
    if (!(code instanceof Uint8Array)) throw new Error('code must be Uint8Array')
    const codec = this.#codeToCodec(code)
    const value = codec.decode(code, asRefs)
    return value
  }

  /**
   * @param {any} variable
   * @returns {Uint8Array}
   */
  encodeVariable (variable) {
    const code = this.encode(variable)
    const variableCode = this.#codecsByName.VARIABLE._encode(code)
    return variableCode
  }

  /**
   * @param {any} value
   * @param {boolean|Array.<boolean>} [asRefs]
   * @returns {Uint8Array}
   */
  encode (value, asRefs) {
    for (const type in this.#codecsByName) {
      const codec = this.#codecsByName[type]
      const code = codec.encode(value, asRefs)
      if (code) {
        return code
      }
    }
  }

  /**
   * @param {Uint8Array} [code]
   * @param {number} [dereferences] depth to recursively inspect parts
   * @returns {Array.<InspectionReport>}
   */
  inspect (code = this.slice(), dereferences) {
    const reports = []
    while (code.length) {
      const codec = this.#codeToCodec(code)
      const report = codec.inspect(code, dereferences)
      reports[code.length - 1] = report
      code = code.subarray(0, -report.width)
    }
    return reports
  }

  /**
   * Decomposes packed code into its constituent subcodes (back to front) and
   * appends each one via Addressifier.appendCode. Returns the address of the
   * last (outermost) subcode.
   * @param {Uint8Array} code
   * @returns {number}
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
}
