import { combineUint8ArrayLikes } from '../../utils/combineUint8ArrayLikes.js'
import { CodeToAddressMap } from '../../utils/CodeToAddressMap.js'

/**
 * @typedef {import('../U8aTurtle.js').U8aTurtle} U8aTurtle
 * @typedef {{type: string, width: number, footer: number, childCount: number, encode: (value:any) => number, decode: (address:number) => any}} Codec
 */

/** @type {Array.<Codec>}  */
const codecs = []
function pushCodec (codec) {
  const footer = codecs.length
  codec.footer = footer
  codec.width ??= 0
  codec.childCount ??= 0
  codec.inspect = inspect
  if (footer > 0xff) throw new Error('too many footers to store in one byte')
  codecs[footer] = codec
  return footer
}

export class Address {
  constructor (address) {
    this.address = address
  }
}

export class Duple {
  constructor (v0, v1) {
    this.v0 = v0
    this.v1 = v1
  }
}

/**
 *
 * @param {number} address
 * @param {AnyCodec} anyCodec
 * @returns {any}
 */
export function inspect (address, anyCodec) {
  const footer = anyCodec.codeToAddressMap.arrayOfUint8Arrays.byteAt(address)
  const uint8ArrayIndex = anyCodec.codeToAddressMap.arrayOfUint8Arrays.byteIndexToIndex(address)
  const arrayInfo = anyCodec.codeToAddressMap.arrayOfUint8Arrays.uint8ArrayInfos[uint8ArrayIndex]
  const uint8Array = arrayInfo.uint8Array
  // const uint8Array = anyCodec.codeToAddressMap.arrayOfUint8Arrays.
  const codec = codecs[footer]
  const childReports = new Array(codec.childCount)
  let childUint8Array = uint8Array.subarray(0, -1 - codec.width)
  for (let i = childReports.length - 1; i >= 0; --i) {
    const childReport = inspect(childUint8Array)
    childReports.push(childReport)
    childUint8Array = childUint8Array.subarray(0, -1 - childReport.width)
  }
  const report = {
    type: codec.type,
    address,
    footer,
    width: codec.width,
    childCount: codec.childCount,
    childReports,
    value: codec.decode(uint8Array)
  }
  return report
}

export class AnyCodec {
  codeToAddressMap = new CodeToAddressMap()

  decode (address, refsOptions, anyCodec = this) {
    const uint8Array = this.codeToAddressMap.get(address)
    const footer = uint8Array.at(uint8Array.length - 1)
    return codecs[footer].decode(uint8Array.subarray(0, uint8Array.length - 1), refsOptions, anyCodec)
  }

  encode (value, refsOptions, anyCodec = this) {
    const footer = selectFooter(value)
    const code = combineUint8ArrayLikes([codecs[footer].encode(value), footer])
    const address = this.codeToAddressMap.get(code)
    if (address >= 0) return address
    return this.codeToAddressMap.set(code)
  }

  inspect (address) {
    return inspect(address, this)
  }
}

const undefinedFooter = pushCodec({
  type: 'undefined',
  decode: () => undefined,
  encode: () => []
})

const nullFooter = pushCodec({
  type: 'null',
  decode: () => null,
  encode: () => []
})

const [falseFooter, trueFooter] = [false, true].map(value => pushCodec({
  type: 'boolean',
  decode: () => value,
  encode: () => []
}))

const uint8Footer = pushCodec({
  type: 'uint8',
  width: 1,
  decode: uint8Array => uint8Array[uint8Array.length - 1],
  encode: uint8 => uint8
})

const int16Footer = pushCodec({
  type: 'int16',
  width: 2,
  decode: uint8Array => new Int16Array(uint8Array.slice(-2).buffer)[0],
  encode: int16 => new Int16Array([int16]).buffer
})

const float64Footer = pushCodec({
  type: 'float64',
  width: 8,
  decode: uint8Array => new Float64Array(uint8Array.slice(-8).buffer)[0],
  encode: float64 => new Float64Array([float64]).buffer
})

const dateFooter = pushCodec({
  type: 'date',
  width: 8,
  decode: uint8Array => new Date(new Float64Array(uint8Array.slice(-8).buffer)[0]),
  encode: date => new Float64Array([date.getTime()]).buffer
})

const wordFooters = [0, 1, 2, 3, 4].map(width => pushCodec({
  type: 'word',
  width,
  decode: uint8Array => uint8Array.slice(-width),
  encode: uint8Array => uint8Array
}))

const addressFooters = [1, 2, 3, 4].map(width => pushCodec({
  type: 'word',
  width,
  decode: uint8Array => uint8Array.slice(-width),
  encode: uint8Array => {
  }
}))

const dupleFooter = pushCodec({
  type: 'duple',
  childCount: 2,
  decode: (uint8Array, refsOptions, anyCodec) => {
    const rightFooter = uint8Array.at(-1)
    const rightCodec = codecs[rightFooter]
    const leftUint8Array = uint8Array.subarray(0, -1 - rightCodec.width)
    return [
      anyCodec.decode(leftUint8Array, refsOptions, anyCodec),
      anyCodec.decode(uint8Array, refsOptions, anyCodec)
    ]
  },
  encode (duple, refsOptions, anyCodec) {
    const leftCode = anyCodec.encode(duple[0], refsOptions, anyCodec)
    const rightCode = anyCodec.encode(duple[1], refsOptions, anyCodec)
  }
})

function selectFooter (value) {
  if (value === undefined) return undefinedFooter
  if (value === null) return nullFooter
  if (value === false) return falseFooter
  if (value === true) return trueFooter
  if (typeof value === 'number') {
    if ((value & 0xff) === value) {
      return uint8Footer
    } else if (((value + 0x8000) & 0xffff) - 0x8000 === value) {
      return int16Footer
    } else {
      return float64Footer
    }
  } else if (value instanceof Date) {
    return dateFooter
  } else if (value instanceof Uint8Array && value.length <= 4) {
    return wordFooters[value.length]
  } else if (value instanceof Address) {
    numberToBytes(value.address)
    return addressFooters
  } else if (value instanceof Duple) {
    return dupleFooter
  }
}

function numberToBytes (number) {
  const bytes = 4 - (Math.clz32(number) >> 3)
  return new Uint8Array(new Uint32Array([number]).buffer).slice(-bytes || -1)
}
