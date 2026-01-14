import { Codec } from './Codec.js'

export class NullCodec extends Codec {
  decode () { return null }
  encode () { return new Uint8Array() }
}
