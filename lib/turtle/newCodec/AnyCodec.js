import { combineUint8ArrayLikes } from '../../utils/combineUint8ArrayLikes.js'
import { Codec } from './Codec.js'
import { BooleanCodec } from './BooleanCodec.js'
import { NullCodec } from './NullCodec.js'
import { NumberCodec } from './NumberCodec.js'
import { UndefinedCodec } from './UndefinedCodec.js'
import { DateCodec } from './DateCodec.js'

/**
 * @typedef {import('../U8aTurtle.js').U8aTurtle} U8aTurtle
 */

/** @type {Array.<{codec:Codec, versions:Array.<(version: number) => void}>}  */
const footersInfo = []
function addFooter (codec, transform) {
  const footer = footersInfo.length
  if (footer > 0xff) throw new Error('too many footers to store in one byte')
  footersInfo[footer] = { codec, decode: transform }
  return footer
}
const undefinedCodec = new UndefinedCodec()
const undefinedFooter = addFooter(undefinedCodec, () => undefinedCodec.decode())
const nullCodec = new NullCodec()
const nullFooter = addFooter(nullCodec, () => nullCodec.decode())
const falseByte = new Uint8Array([0])
const trueByte = new Uint8Array([1])
const booleanCodec = new BooleanCodec()
const falseFooter = addFooter(booleanCodec, () => booleanCodec.decode(falseByte))
const trueFooter = addFooter(booleanCodec, () => booleanCodec.decode(trueByte))
const numberCodec = new NumberCodec()
const numberFooter = addFooter(numberCodec, uint8Array => numberCodec.decode(uint8Array.slice(-8)))
const dateCodec = new DateCodec()
const dateFooter = addFooter(dateCodec, uint8Array => dateCodec.decode(uint8Array.slice(-8)))

export class AnyCodec extends Codec {
  /**
   * @param {Uint8Array} uint8Array
   * @param {U8aTurtle} u8aTurtle
   * @param {*} refsOptions
   * @returns
   */
  decode (uint8Array, u8aTurtle, refsOptions) {
    const footer = uint8Array[uint8Array.length - 1]
    console.log(footer)
    console.log(footersInfo)
    return footersInfo[footer].decode(uint8Array.slice(0, uint8Array.length - 1))
  }

  encode (value, turtleDictionary, refsOptions) {
    if (value === undefined) return new Uint8Array([undefinedFooter])
    if (value === null) return new Uint8Array([nullFooter])
    if (value === false) return new Uint8Array([falseFooter])
    if (value === true) return new Uint8Array([trueFooter])
    if (typeof value === 'number') return combineUint8ArrayLikes([numberCodec.encode(value), numberFooter])
    if (value instanceof Date) return combineUint8ArrayLikes([dateCodec.encode(value), dateFooter])
  }
}
