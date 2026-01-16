import { ArrayOfUint8Arrays, CodeToAddressMap, countMatchingBits } from './CodeToAddressMap.js'
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
  suite.it('ArrayOfUint8Arrays appends and ats', async ({ assert }) => {
    const arrayOfUint8Arrays = new ArrayOfUint8Arrays()
    let byteLength = 0
    const appendAndTest = length => {
      const ints = []
      for (let i = 0; i < length; ++i) {
        ints.push(byteLength + i)
      }
      byteLength += length
      arrayOfUint8Arrays.append(new Uint8Array(ints))
      for (let i = 0; i < byteLength; ++i) {
        assert.equal(arrayOfUint8Arrays.byteAt(i), i)
      }
      assert.equal(arrayOfUint8Arrays.byteAt(byteLength), undefined)
    }
    appendAndTest(30)
    appendAndTest(12)
    appendAndTest(5)
    appendAndTest(1)
    appendAndTest(12)
  })
  suite.it('sets and gets addresses by code', async ({ assert }) => {
    const codeToAddressMap = new CodeToAddressMap()
    const zero = new Uint8Array([0x00])
    const zeroAddress = codeToAddressMap.set(zero)
    const fff0 = new Uint8Array([0xff, 0xf0])
    const fff0Address = codeToAddressMap.set(fff0)
    const ff = new Uint8Array([0xff])
    const ffAddress = codeToAddressMap.set(ff)
    const f0 = new Uint8Array([0xf0])
    const f0Address = codeToAddressMap.set(f0)
    const ffffff = new Uint8Array([0xff, 0xff, 0xff])
    const ffffffAddress = codeToAddressMap.set(ffffff)
    assert.equal(codeToAddressMap.get(zero), zeroAddress)
    assert.equal(codeToAddressMap.get(fff0), fff0Address)
    assert.equal(codeToAddressMap.get(ff), ffAddress)
    assert.equal(codeToAddressMap.get(f0), f0Address)
    assert.equal(codeToAddressMap.get(ffffff), ffffffAddress)

    codeToAddressMap.delete(ffffff)
    assert.equal(codeToAddressMap.get(ffffff), undefined)

    const clonedMap = codeToAddressMap.cloneAt(ffAddress)
    assert.equal(clonedMap.get(zero), zeroAddress)
    assert.equal(clonedMap.get(fff0), fff0Address)
    assert.equal(clonedMap.get(ff), ffAddress)
    assert.equal(clonedMap.get(f0), undefined)
    assert.equal(clonedMap.get(ffffff), undefined)
    const clonedffffffAddress = clonedMap.set(ffffff)
    assert.equal(clonedMap.get(ffffff), clonedffffffAddress)
  })
})
