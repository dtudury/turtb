import { combineUint8ArrayLikes } from '../../utils/combineUint8ArrayLikes.js'
import { Codec } from './Codec.js'
import { BooleanCodec } from './BooleanCodec.js'
import { NullCodec } from './NullCodec.js'
import { NumberCodec } from './NumberCodec.js'
import { UndefinedCodec } from './UndefinedCodec.js'
import { DateCodec } from './DateCodec.js'
import { WordCodec } from './WordCodec.js'

/**
 * @typedef {import('../U8aTurtle.js').U8aTurtle} U8aTurtle
 */

/** @type {Array.<{codec:Codec, versions:Array.<(version: number) => void}>}  */
const encodeDecodeByFooter = []
function pushCodec (codec, decode = codec.decode) {
  const footer = encodeDecodeByFooter.length
  if (footer > 0xff) throw new Error('too many footers to store in one byte')
  encodeDecodeByFooter[footer] = { codec, decode }
  return footer
}

export class AnyCodec extends Codec {
  // encodingTree = new EncodingTree()

  decode (uint8Array, refsOptions, anyCodec = this) {
    const footer = uint8Array.at(uint8Array.length - 1)
    return encodeDecodeByFooter[footer].decode(uint8Array.subarray(0, uint8Array.length - 1), refsOptions, anyCodec)
  }

  encode (value, refsOptions, anyCodec = this) {
    let encoded
    if (value === undefined) {
      encoded = new Uint8Array([undefinedFooter])
    } else if (value === null) {
      encoded = new Uint8Array([nullFooter])
    } else if (value === false) {
      encoded = new Uint8Array([falseFooter])
    } else if (value === true) {
      encoded = new Uint8Array([trueFooter])
    } else if (typeof value === 'number') {
      encoded = combineUint8ArrayLikes([numberCodec.encode(value), numberFooter])
    } else if (value instanceof Date) {
      encoded = combineUint8ArrayLikes([dateCodec.encode(value), dateFooter])
    } else if (value instanceof Uint8Array && value.length <= 4) {
      encoded = combineUint8ArrayLikes([wordCodec.encode(value), wordFooters[value.length]])
    }
    return encoded
  }

  lookup (encoded) {

  }
}

// const anyCodec = new AnyCodec()
// const anyFooters = [1, 2, 3, 4].map(length => length => pushCodec(anyCodec, uint8Array => anyCodec.decode(uint8Array.slice(-length))))
const undefinedCodec = new UndefinedCodec()
const undefinedFooter = pushCodec(undefinedCodec)
const nullCodec = new NullCodec()
const nullFooter = pushCodec(nullCodec)
const falseByte = new Uint8Array([0])
const trueByte = new Uint8Array([1])
const booleanCodec = new BooleanCodec()
const falseFooter = pushCodec(booleanCodec, () => booleanCodec.decode(falseByte))
const trueFooter = pushCodec(booleanCodec, () => booleanCodec.decode(trueByte))
const numberCodec = new NumberCodec()
const numberFooter = pushCodec(numberCodec, uint8Array => numberCodec.decode(uint8Array.slice(-8)))
const dateCodec = new DateCodec()
const dateFooter = pushCodec(dateCodec, uint8Array => dateCodec.decode(uint8Array.slice(-8)))
const wordCodec = new WordCodec()
const wordFooters = [0, 1, 2, 3, 4].map(length => pushCodec(wordCodec, uint8Array => wordCodec.decode(uint8Array.slice(-length))))
