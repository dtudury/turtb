import { Codec } from './Codec.js'

export class BooleanCodec extends Codec {
  decode (uint8Array) { return Boolean(uint8Array[0]) }
  encode () { return new Uint8Array() }
}
