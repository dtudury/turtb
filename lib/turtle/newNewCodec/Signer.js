import { cryptoPromise, hashNameAndPassword } from '../../utils/crypto.js'
import { getPublicKey, signAsync, verify } from '../../utils/noble-secp256k1.js'

/**
 * @typedef {import('./Signature.js').Signature} Signature
 */

export class Signer {
  /** @type {Object.<string, KeyPair>} */
  keysByName = {}

  /**
   * @param {string} username
   * @param {string} password
   */
  constructor (username, password) {
    this.username = username
    this.hashwordPromise = hashNameAndPassword(username, password)
  }

  /**
   * @param {string} turtlename
   * @returns {KeyPair}
   */
  async makeKeysFor (turtlename) {
    if (!(this.keysByName[turtlename])) {
      const hashword = await this.hashwordPromise
      const privateKey = await hashNameAndPassword(turtlename, hashword)
      const publicKey = getPublicKey(privateKey)
      this.keysByName[turtlename] = { privateKey, publicKey }
    }
    return this.keysByName[turtlename]
  }

  /**
   * @param {string} turtleName
   * @param {Uint8Array} uint8Array
   * @returns {Uint8Array}
   */
  async sign (turtleName, uint8Array) {
    const { privateKey } = await this.makeKeysFor(turtleName)
    const hash = await digestData(uint8Array)
    const signature = await signAsync(hash, privateKey)
    return signature.toCompactRawBytes()
  }
}

/**
 * @param {Uint8Array} publicKey
 * @param {Uint8Array} uint8Array
 * @param {Signature} signature
 * @returns {boolean}
 */
export async function verifySignature (publicKey, uint8Array, signature) {
  try {
    const hash = await digestData(uint8Array)
    return verify(signature, hash, publicKey)
  } catch (error) {
    console.error(error)
    return false
  }
}

/**
 * @param {Uint8Array} uint8Array
 * @returns {Uint8Array}
 */
const digestData = async uint8Array => {
  const { subtle } = await cryptoPromise
  const digested = await subtle.digest('SHA-256', uint8Array)
  return new Uint8Array(digested)
}
