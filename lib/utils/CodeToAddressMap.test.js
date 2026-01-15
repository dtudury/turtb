import { CodeToAddressMap, countMatchingBits } from './CodeToAddressMap.js'
import { globalTestRunner, urlToName } from './TestRunner.js'

globalTestRunner.only.describe(urlToName(import.meta.url), suite => {
  suite.it('correctly counts matching bits', async ({ assert }) => {
    assert.equal(countMatchingBits(
      new Uint8Array([0b11111111, 0b11111111]),
      new Uint8Array([0b11111111, 0b11111111, 0b11111111])), 16)
    assert.equal(countMatchingBits(
      new Uint8Array([0b11111111, 0b11111111, 0b11111111]),
      new Uint8Array([0b11111111, 0b11111111])), 16)
    assert.equal(countMatchingBits(
      new Uint8Array([0b11111111, 0b11111111]),
      new Uint8Array([0b11111111, 0b11011111])), 10)
    assert.equal(countMatchingBits(
      new Uint8Array([0b11111111, 0b11111111]),
      new Uint8Array([0b11111111])), 8)
    assert.equal(countMatchingBits(
      new Uint8Array([0b11101111, 0b11111111]),
      new Uint8Array([0b11111111, 0b11011111])), 3)
    assert.equal(countMatchingBits(
      new Uint8Array([0b11101111, 0b11111111]),
      new Uint8Array([0b01111111, 0b11011111])), 0)
    assert.equal(countMatchingBits(
      new Uint8Array(),
      new Uint8Array([0b01111111, 0b11011111])), 0)
    assert.equal(countMatchingBits(
      new Uint8Array(),
      new Uint8Array()), 0)
  })
  suite.it('sets and gets addresses by code', async ({ assert }) => {
    const codeToAddressMap = new CodeToAddressMap()
    const fff0 = new Uint8Array([0xff, 0xf0])
    codeToAddressMap.getAddressOrSetter(fff0)(123)
    const ff = new Uint8Array([0xff])
    codeToAddressMap.getAddressOrSetter(ff)(234)
    const f0 = new Uint8Array([0xf0])
    codeToAddressMap.getAddressOrSetter(f0)(321)
    console.log(codeToAddressMap)
    const ffffff = new Uint8Array([0xff, 0xff, 0xff])
    codeToAddressMap.getAddressOrSetter(ffffff)(111)
    console.log(codeToAddressMap)
    assert.equal(codeToAddressMap.getAddressOrSetter(ff), 234)
    assert.equal(codeToAddressMap.getAddressOrSetter(f0), 321)
    assert.equal(codeToAddressMap.getAddressOrSetter(ffffff), 111)
    assert.throw(() => {
      codeToAddressMap.encode()
    })
    assert.throw(() => {
      codeToAddressMap.decode()
    })
    assert.throw(() => {
      codeToAddressMap.describe()
    })
  })
})
