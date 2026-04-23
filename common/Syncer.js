import { Recaller } from '../../utils/Recaller.js'
import { Terrapin } from './Terrapin.js'

export class Syncer extends Terrapin {
  #signedTerrapinsByPublicKey = {}
  /**
   * @param {Terrapin} turtle
   */
  constructor (syncee = new Terrapin(), recaller = new Recaller('Syncer(default)')) {
    super(recaller)
    this.syncee = syncee
  }

  /**
   * @param {Terrapin} turtle
   * @param {Uint8Array} publicKey
   */
  addSignedTerrapin (turtle, publicKey) {
    this.removeSignedTerrapin(publicKey)
    const publicKeyHex = publicKey.toHex()
    const f = () => { this.#update(publicKeyHex, turtle.byteLength) }
    this.#signedTerrapinsByPublicKey[publicKeyHex] = { f, turtle, publicKey }
    this.recaller.watch(publicKeyHex, f)
  }

  removeSignedTerrapin (publicKey) {
    const publicKeyHex = publicKey.toHex()
    if (!this.#signedTerrapinsByPublicKey[publicKeyHex]) return
    const { f } = this.#signedTerrapinsByPublicKey[publicKeyHex]
    this.recaller.unwatch(f)
    delete this.#signedTerrapinsByPublicKey[publicKeyHex]
  }

  #update (publicKeyHex, byteLength) {

  }
}
