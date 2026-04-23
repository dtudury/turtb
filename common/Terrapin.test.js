import { globalTestRunner, urlToName } from '../lib/utils/TestRunner.js'
import { Terrapin } from './Terrapin.js'
import { SignetTurtle } from './SignetTurtle.js'
import { Duple } from './Duple.js'
import { Signature } from './Signature.js'
import { Signer } from './Signer.js'
import { Commit } from './Commit.js'

globalTestRunner.only.describe(urlToName(import.meta.url), suite => {
  suite.it('encodes and decodes values', async ({ assert }) => {
    const compositeCodec = new SignetTurtle()
    // compositeCodec.recaller.watch('test', () => {
    //   if (compositeCodec.byteLength > 0) {
    //     console.log(compositeCodec.decode(compositeCodec.byteLength - 1))
    //   }
    // })
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
      new Commit(new Uint8Array([3, 4, 5, 6, 7, 8, 9])),
      new Signature(1234, new Uint8Array(64))
    ]
    values.forEach(value => {
      const code = compositeCodec.encodeVariable(value)
      const decoded = compositeCodec.decode(code)
      assert.equal(decoded, value, `round-trips ${Object.prototype.toString.call(value)}`)
    })

    const report = compositeCodec.inspect()
    console.log(report)
    const preSignatureAddress = compositeCodec.byteLength - 1

    const signer = new Signer('kidd', 'crypto')
    const turtleName = 'Moymoy'
    const keys = await signer.makeKeysFor(turtleName)
    const signature = await compositeCodec.sign(signer, turtleName)
    const verified = await compositeCodec.verify(signature, keys.publicKey)
    assert.assert(verified, 'signature verifies')

    const clone = compositeCodec.clone(preSignatureAddress)
    assert.equal(clone.decode(clone.byteLength - 1), new Signature(1234, new Uint8Array(64)), 'clone last value is the pre-signature Signature')
    assert.equal(clone.decode(), new Signature(1234, new Uint8Array(64)), 'clone default decode is the pre-signature Signature')

    const asData = clone.slice()
    const rehydrate = new Terrapin()
    rehydrate.appendCode(asData)
    assert.equal(rehydrate.decode(rehydrate.byteLength - 1), new Signature(1234, new Uint8Array(64)), 'rehydrated terrapin decodes last value correctly')
  })

  suite.it('decodes with asRefs returns address-based maps', async ({ assert }) => {
    const t = new Terrapin()
    const code = t.encode({ a: 1 })
    console.log({ code })
    console.log(t.decode(code))
    console.log(t.decode(code, true))

    // asRefs=true: values become addresses, names stay as strings
    const withTrue = t.decode(code, true)
    await assert.equal(Object.keys(withTrue), ['a'], 'asRefs=true: key is string name')
    await assert.equal(typeof withTrue.a, 'number', 'asRefs=true: value is an address')
    await assert.equal(t.decode(withTrue.a), 1, 'asRefs=true: address decodes to original value')

    // asRefs=[true, false]: value is address, name is string — same as asRefs=true
    const withValueRef = t.decode(code, [true, false])
    await assert.equal(Object.keys(withValueRef), ['a'], 'asRefs=[true,false]: key is string name')
    await assert.equal(typeof withValueRef.a, 'number', 'asRefs=[true,false]: value is an address')
    await assert.equal(t.decode(withValueRef.a), 1, 'asRefs=[true,false]: address decodes to original value')

    // asRefs=[false, true]: value stays decoded, name becomes address
    const withNameRef = t.decode(code, [false, true])
    await assert.equal(Object.values(withNameRef), [1], 'asRefs=[false,true]: value is decoded')
    const nameAddresses = Object.keys(withNameRef).map(Number)
    await assert.equal(nameAddresses.length, 1, 'asRefs=[false,true]: one key')
    await assert.equal(t.decode(nameAddresses[0]), 'a', 'asRefs=[false,true]: key is address of name')
  })
})
