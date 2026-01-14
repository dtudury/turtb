import { Codec } from './Codec.js'

export class FalseCodec extends Codec {
  decode () { return false }
  encode () { return new Uint8Array() }
}
