import { globalTestRunner, urlToName } from './utils/TestRunner.js'
import { Addressifier } from './Addressifier.js'

globalTestRunner.skip.describe(urlToName(import.meta.url), suite => {
  suite.it('streams', async ({ assert }) => {
    const a = new Addressifier()
    const b = new Addressifier()
    a.makeReadableStream().pipeTo(b.makeWritableStream())
    const u8a123 = new Uint8Array([1, 2, 3])
    a.appendCode(u8a123)
    assert.equal(u8a123, await b.nextCode)
    assert.equal(u8a123, b.getUint8ArrayAt())
    const u8a234 = new Uint8Array([2, 3, 4])
    const u8a456 = new Uint8Array([4, 5, 6])
    a.appendCode(u8a234)
    a.appendCode(u8a456)
    assert.equal(u8a234, await b.nextCode)
    await new Promise(resolve => setTimeout(resolve))
    assert.equal(u8a456, b.getUint8ArrayAt())
  })
})
