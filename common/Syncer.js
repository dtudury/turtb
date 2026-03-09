import { Recaller } from '../../utils/Recaller.js'
import { Turtle } from './Turtle.js'

export class Syncer extends Turtle {
  #signedTurtlesByPublicKey = {}
  /**
   * @param {Turtle} turtle
   */
  constructor (syncee = new Turtle(), recaller = new Recaller('Syncer(default)')) {
    super(recaller)
    this.syncee = syncee
  }

  /**
   * @param {Turtle} turtle
   * @param {Uint8Array} publicKey
   */
  addSignedTurtle (turtle, publicKey) {
    this.removeSignedTurtle(publicKey)
    const publicKeyHex = publicKey.toHex()
    const f = () => { this.#update(publicKeyHex, turtle.byteLength) }
    this.#signedTurtlesByPublicKey[publicKeyHex] = { f, turtle, publicKey }
    this.recaller.watch(publicKeyHex, f)
  }

  removeSignedTurtle (publicKey) {
    const publicKeyHex = publicKey.toHex()
    if (!this.#signedTurtlesByPublicKey[publicKeyHex]) return
    const { f } = this.#signedTurtlesByPublicKey[publicKeyHex]
    this.recaller.unwatch(f)
    delete this.#signedTurtlesByPublicKey[publicKeyHex]
  }

  #update (publicKeyHex, byteLength) {

  }
}
