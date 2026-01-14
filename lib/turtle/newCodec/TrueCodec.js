import { Codec } from './Codec.js'

export class TrueCodec extends Codec {
  decode () { return true }
  encode () { return new Uint8Array() }
}
