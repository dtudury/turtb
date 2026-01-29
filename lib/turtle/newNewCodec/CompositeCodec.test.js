import { globalTestRunner, urlToName } from '../../utils/TestRunner.js'
import { CompositeCodec, Duple } from './CompositeCodec.js'

globalTestRunner.only.describe(urlToName(import.meta.url), suite => {
  suite.it('encodes and decodes values', async ({ assert }) => {
    const compositeCodec = new CompositeCodec()
    const values = [
      undefined, null, false, true,
      new Uint8Array([1, 2, 3]),
      new Uint8Array([4, 5, 6, 7]),
      new Duple([true, false]),
      new Duple([new Duple([new Uint8Array([9, 0, 1]), null]), true]),
      new Uint8Array([100, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11])
    ]
    values.forEach(value => {
      const code = compositeCodec.encodeVariable(value)
      // console.log(code)
      const decoded = compositeCodec.decode(code)
      // console.log(decoded)
      assert.equal(decoded, value)
      const inspected = compositeCodec.inspect(code)
      console.log(JSON.stringify(inspected, null, 2))
      console.log(inspected)
    })
    console.log(compositeCodec.byteLength)
  })
})
