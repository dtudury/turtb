import { Codec } from './Codec.js'

export class UndefinedCodec extends Codec {
  decode () { return undefined }
  encode () { return new Uint8Array() }
}
