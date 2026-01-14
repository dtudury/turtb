import { Codec } from './Codec.js'

export class DateCodec extends Codec {
  decode (uint8Array) {
    return new Date(new Float64Array(uint8Array.buffer)[0])
  }

  encode (date) { return new Uint8Array(new Float64Array([date.getTime()]).buffer) }
}
