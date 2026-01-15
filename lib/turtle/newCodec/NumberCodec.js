import { Codec } from './Codec.js'

export class NumberCodec extends Codec {
  decode (uint8Array) {
    return new Float64Array(uint8Array.buffer)[0]
  }

  encode (number) {
    return new Uint8Array(new Float64Array([number]).buffer)
  }
}
