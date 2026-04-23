import { Signature } from './Signature.js'
import { verifySignature } from './Signer.js'
import { Terrapin } from './Terrapin.js'

/**
 * Extends Terrapin with secp256k1 signing and verification.
 * A signet historically was a personal seal used to authenticate documents.
 */
export class SignetTurtle extends Terrapin {
  /** @type {number} */
  #signedLength = 0

  /**
   * @param {import('./Signer.js').Signer} signer
   * @param {string} turtleName
   * @returns {Promise.<Signature>}
   */
  async sign (signer, turtleName) {
    const oldByteLength = this.byteLength
    const uint8Array = this.slice(this.#signedLength, this.byteLength - 1)
    const compactRawBytes = await signer.sign(turtleName, uint8Array)
    if (this.byteLength !== oldByteLength) throw new Error('byteLength changed while signing')
    const signature = new Signature(this.#signedLength, compactRawBytes)
    const encodedSignature = this.encode(signature)
    this.appendCode(encodedSignature)
    this.#signedLength = oldByteLength
    return signature
  }

  /**
   * @param {Signature} signature
   * @param {Uint8Array} publicKey
   * @returns {Promise.<boolean>}
   */
  async verify (signature, publicKey) {
    const encodedSignature = this.encode(signature)
    const address = this.codeToAddressMap.get(encodedSignature)
    const width = encodedSignature.length
    const uint8Array = this.slice(signature.address, address - width)
    return verifySignature(publicKey, uint8Array, signature.compactRawBytes)
  }
}
