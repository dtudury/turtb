import { combineUint8ArrayLikes } from '../../utils/combineUint8ArrayLikes.js'
import { CodeToAddressMap } from '../../utils/CodeToAddressMap.js'

/**
 * @typedef {import('../U8aTurtle.js').U8aTurtle} U8aTurtle
 * @typedef {{encode: (value:any) => number, decode: (address:number) => any}} Codec
 */

/** @type {Array.<Codec>}  */
const codecByFooter = []
function pushCodec (codec) {
  const footer = codecByFooter.length
  if (footer > 0xff) throw new Error('too many footers to store in one byte')
  codecByFooter[footer] = codec
  return footer
}

const builtInValues = [
  undefined,
  null,
  false,
  true
]

export class Duple {
  constructor (code0, code1) {
    this.code0 = code0
    this.code1 = code1
  }
}

export class AnyCodec {
  codeToAddressMap = new CodeToAddressMap()

  decode (address, refsOptions, anyCodec = this) {
    if (address < 0) return builtInValues[-address - 1]
    const uint8Array = this.codeToAddressMap.get(address)
    const footer = uint8Array.at(uint8Array.length - 1)
    return codecByFooter[footer].decode(uint8Array.subarray(0, uint8Array.length - 1), refsOptions, anyCodec)
  }

  encode (value, refsOptions, anyCodec = this) {
    if (builtInValues.includes(value)) return -1 - builtInValues.indexOf(value)
    let footer
    if (typeof value === 'number') {
      if ((value & 0xff) === value) {
        footer = uint8Footer
      } else if (((value + 0x8000) & 0xffff) - 0x8000 === value) {
        footer = int16Footer
      } else {
        footer = float64Footer
      }
    } else if (value instanceof Duple) {
      // code = combineUint8ArrayLikes([dupleCodec.encode(value), dupleFooter])
    } else if (value instanceof Date) {
      footer = dateFooter
    } else if (value instanceof Uint8Array && value.length <= 4) {
      footer = wordFooters[value.length]
    }
    const code = combineUint8ArrayLikes([codecByFooter[footer].encode(value), footer])
    const address = this.codeToAddressMap.get(code)
    if (address >= 0) return address
    return this.codeToAddressMap.set(code)
  }

  lookup (encoded) {

  }
}

const uint8Codec = {
  decode: uint8Array => uint8Array[uint8Array.length - 1],
  encode: uint8 => uint8
}
const uint8Footer = pushCodec(uint8Codec)

const int16Codec = {
  decode: uint8Array => new Int16Array(uint8Array.slice(-2).buffer)[0],
  encode: int16 => new Int16Array([int16]).buffer
}
const int16Footer = pushCodec(int16Codec)

const float64Codec = {
  decode: uint8Array => new Float64Array(uint8Array.slice(-8).buffer)[0],
  encode: float64 => new Float64Array([float64]).buffer
}
const float64Footer = pushCodec(float64Codec)

const dateCodec = {
  decode: uint8Array => new Date(new Float64Array(uint8Array.slice(-8).buffer)[0]),
  encode: date => new Float64Array([date.getTime()]).buffer
}
const dateFooter = pushCodec(dateCodec)

// const dupleCodecs = [1, 2, 3, 4].map(n => ({
//   decode: 1,
//   encode: 2
// }))
// const dupleFooters = dupleCodecs.map(dupleCodec => pushCodec(dupleCodec))

const wordFooters = [0, 1, 2, 3, 4].map(length => pushCodec({
  decode: uint8Array => uint8Array.slice(-length),
  encode: uint8Array => uint8Array
}))
console.log(wordFooters)

// const wordFooters = [0, 1, 2, 3, 4].map(length => pushCodec(wordCodec, uint8Array => wordCodec.decode(uint8Array.slice(-length))))

// decode (uint8Array) {
//   return new Date(new Float64Array(uint8Array.buffer)[0])
// }

// encode (date) { return new Uint8Array(new Float64Array([date.getTime()]).buffer) }
