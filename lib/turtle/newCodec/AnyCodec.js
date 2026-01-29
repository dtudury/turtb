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

function numberByteWidth (number) {
  const bytes = 4 - (Math.clz32(number) >> 3)
  return bytes || 1 // we'll still use a byte to store zero
}

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
    return addressFooters[numberByteWidth(value.address)]
  } else if (value instanceof Duple) {
    return dupleFooter
  }
}

function calculateChildWidth (address, anyCodec) {
  let width = 1
  const footer = anyCodec.codeToAddressMap.arrayOfUint8Arrays.byteAt(address)
  const codec = codecs[footer]
  width += codec.width
  for (let i = 0; i < codec.childCount; ++i) {
    width += calculateChildWidth(address - width, anyCodec)
  }
  return width
}

/**
 *
 * @param {number} address
 * @param {AnyCodec} anyCodec
 * @returns {any}
 */
export function inspect (address, refsOptions, anyCodec) {
  let uint8Array
  let footer
  if (address instanceof Uint8Array) {
    uint8Array = address
    footer = uint8Array.at(uint8Array.length - 1)
  } else {
    footer = anyCodec.at(address)
    uint8Array = anyCodec.codeToAddressMap.get(address)
  }
  const codec = codecs[footer]
  console.log({ address, footer, codec, uint8Array })
  const childReports = new Array(codec.childCount)
  let width = 1 + codec.getWidth(uint8Array)
  for (let i = childReports.length - 1; i >= 0; --i) {
    const childReport = inspect(address - width, refsOptions, anyCodec)
    console.log({ childReport })
    childReports.push(childReport)
    width += calculateChildWidth(address - width, anyCodec)
  }
  const report = {
    type: codec.type,
    address,
    footer,
    width: codec.width,
    childCount: codec.childCount,
    childReports,
    value: codec.decode(uint8Array.subarray(0, uint8Array.length - 1), refsOptions, anyCodec)
  }
  return report
}

export class AnyCodec {
  codeToAddressMap = new CodeToAddressMap()

  getWidth (address) {
    const uint8Array = this.codeToAddressMap.get(address)
    const footer = uint8Array.at(uint8Array.length - 1)
    return codecs[footer].getWidth(uint8Array.subarray(0, uint8Array.length - 1), this)
  }

  decode (address, refsOptions) {
    const uint8Array = this.codeToAddressMap.get(address)
    const footer = uint8Array.at(uint8Array.length - 1)
    return codecs[footer].decode(uint8Array.subarray(0, uint8Array.length - 1), refsOptions, this)
  }

  encode (value, refsOptions) {
    const footer = selectFooter(value)
    const code = combineUint8ArrayLikes([codecs[footer].encode(value, refsOptions, this), footer])
    let address = this.codeToAddressMap.get(code)
    if (address >= 0) return address
    if (code.length <= numberByteWidth(this.length + code.length)) return code
    address = this.codeToAddressMap.set(code)
    console.log('encoding', { value, footer, code, address })
    return address
  }

  inspect (address, refsOptions) {
    return inspect(address, refsOptions, this)
  }

  get length () {
    return this.codeToAddressMap.byteLength
  }

  mapAddress (address) {
    if (address > this.length) return this.length
    if (address < 0) address += this.length
    if (address < 0) return 0
    return address
  }

  at (address) {
    return this.codeToAddressMap.arrayOfUint8Arrays.byteAt(this.mapAddress(address))
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

function leftBytesToNumber (leftBytes) {
  const withZeroBytes = new Uint8Array([...leftBytes, 0, 0, 0, 0].slice(0, 4))
  return new Uint32Array(withZeroBytes.buffer)[0]
}

const addressFooters = [0, 1, 2, 3, 4].map(width => pushCodec({
  type: 'address',
  width,
  decode: uint8Array => {
    const uint32 = leftBytesToNumber(uint8Array.slice(-width))
    return new Address(uint32)
  },
  encode: address => new Uint8Array(new Uint32Array([address.address]).buffer).slice(0, width)
}))

const dupleFooters = [1, 2, 3, 4].map(aWidth => [1, 2, 3, 4].map(bWidth => pushCodec({
  type: 'duple',
  width: aWidth + bWidth,
  decode: (uint8Array, refsOptions, anyCodec) => {
    const rightFooter = uint8Array.at(-1)
    const rightCodec = codecs[rightFooter]
    const rightUint8Array = uint8Array.subarray(0, -1)
    const leftUint8Array = uint8Array.subarray(0, -1 - rightCodec.width - 1)
    return new Duple(
      anyCodec.decode(leftUint8Array, refsOptions, anyCodec),
      anyCodec.decode(rightUint8Array, refsOptions, anyCodec)
    )
  },
  encode (duple, refsOptions, anyCodec) {
    const leftCode = anyCodec.encode(duple.v0, refsOptions, anyCodec)
    const rightCode = anyCodec.encode(duple.v1, refsOptions, anyCodec)
    return combineUint8ArrayLikes([leftCode, rightCode])
  }
})))

const dupleFooter = pushCodec({
  type: 'duple',
  childCount: 2,
  decode: (uint8Array, refsOptions, anyCodec) => {
    const rightFooter = uint8Array.at(-1)
    console.log({ uint8Array, rightFooter })
    const rightCodec = codecs[rightFooter]
    const rightUint8Array = uint8Array.subarray(0, -1)
    const leftUint8Array = uint8Array.subarray(0, -1 - rightCodec.width - 1)
    return new Duple(
      anyCodec.decode(leftUint8Array, refsOptions, anyCodec),
      anyCodec.decode(rightUint8Array, refsOptions, anyCodec)
    )
  },
  encode (duple, refsOptions, anyCodec) {
    const leftCode = anyCodec.encode(duple.v0, refsOptions, anyCodec)
    const rightCode = anyCodec.encode(duple.v1, refsOptions, anyCodec)
    return []
  }
})
