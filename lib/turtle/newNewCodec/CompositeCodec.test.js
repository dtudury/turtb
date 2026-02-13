import { globalTestRunner, urlToName } from '../../utils/TestRunner.js'
import { CompositeCodec } from './CompositeCodec.js'
import { Duple } from './Duple.js'
import { Signature } from './Signature.js'
import { Signer } from './Signer.js'

globalTestRunner.only.describe(urlToName(import.meta.url), suite => {
  suite.it('encodes and decodes values', async ({ assert }) => {
    const compositeCodec = new CompositeCodec()
    const values = [
      undefined, null, false, true,
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6, 7]),
      new Duple([true, false]),
      new Duple([new Duple([new Uint8Array([9, 0, 1]), null]), true]),
      new Uint8Array([100, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11]),
      'hello composite!',
      4, 123.456, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      { a: 1, b: 2, c: 3 }, { a: 4 }, {},
      [1, 2, 3], ['asdf'], [],
      ['a', 'b', 'c'],
      [100, 1, 2],
      new Date('July 21 1969, 10:56:15 PM EDT'), new Date(),
      [100, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11],
      [,,, 1, 2, 3],
      new Signature(1234, new Uint8Array(64))
    ]
    values.forEach(value => {
      const code = compositeCodec.encodeVariable(value)
      const decoded = compositeCodec.decode(code)
      assert.equal(decoded, value)
    })

    const report = compositeCodec.inspect(compositeCodec.slice())
    const preSignatureAddress = compositeCodec.byteLength - 1

    const signer = new Signer('kiddi', 'kwybdo')
    const turtleName = 'Moymoy'
    const keys = await signer.makeKeysFor(turtleName)
    const signature = await compositeCodec.sign(signer, turtleName)
    const verified = await compositeCodec.verify(signature, keys.publicKey)
    assert.assert(verified)

    const clone = compositeCodec.clone(preSignatureAddress)
    assert.equal(clone.decode(clone.byteLength - 1), new Signature(1234, new Uint8Array(64)))

    const asData = clone.slice()
    const rehydrate = new CompositeCodec()
    rehydrate.appendCode(asData)
    assert.equal(rehydrate.decode(rehydrate.byteLength - 1), new Signature(1234, new Uint8Array(64)))
  })
})
