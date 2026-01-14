import { globalTestRunner, urlToName } from '../../utils/TestRunner.js'
import { Codec } from './Codec.js'

globalTestRunner.describe(urlToName(import.meta.url), suite => {
  suite.it('throws on unimplemented methods', async ({ assert }) => {
    const codec = new Codec()
    assert.throw(() => {
      codec.encode()
    })
    assert.throw(() => {
      codec.decode()
    })
    assert.throw(() => {
      codec.describe()
    })
  })
})
