import { globalTestRunner, urlToName } from '../../utils/TestRunner.js'
import { AnyCodec } from './AnyCodec.js'

globalTestRunner.only.describe(urlToName(import.meta.url), suite => {
  suite.it('encodes and decodes composite types', async ({ assert }) => {
    const codec = new AnyCodec()
    console.log(codec)
  })
  suite.it('encodes and decodes basic types', async ({ assert }) => {
    const codec = new AnyCodec()
    const undefinedCode = codec.encode(undefined)
    assert.equal(codec.decode(undefinedCode), undefined)
    const nullCode = codec.encode(null)
    assert.equal(codec.decode(nullCode), null)
    const falseCode = codec.encode(false)
    assert.equal(codec.decode(falseCode), false)
    const trueCode = codec.encode(true)
    assert.equal(codec.decode(trueCode), true)
    const numbers = [
      1, 2, 0, -1, 1000, -1000, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN, Number.EPSILON, Math.PI, Math.E
    ]
    for (const number of numbers) {
      const numberCode = codec.encode(number)
      assert.equal(codec.decode(numberCode), number)
    }
    const dates = [
      new Date(), new Date(0), new Date(1, 2, 3, 4, 5, 6), new Date('1969-07-20T02:56:15Z')
    ]
    for (const date of dates) {
      const dateCode = codec.encode(date)
      assert.equal(codec.decode(dateCode), date)
    }
    const words = [
      new Uint8Array([1, 2, 3, 4])
    ]
    for (const word of words) {
      const wordCode = codec.encode(word)
      assert.equal(codec.decode(wordCode), word)
    }
  })
})
