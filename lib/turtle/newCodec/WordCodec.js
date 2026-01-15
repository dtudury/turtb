import { Codec } from './Codec.js'

export class WordCodec extends Codec {
  decode (uint8Array) {
    return uint8Array
  }

  encode (word) {
    if (!(word instanceof Uint8Array) || word.length > 4) throw new Error('word must be a short (<=4) length Uint8Array')
    return word
  }
}
