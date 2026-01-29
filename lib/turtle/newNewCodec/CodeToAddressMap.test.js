import { CodeToAddressMap, countMatchingBits } from './CodeToAddressMap.js'
import { globalTestRunner, urlToName } from '../../utils/TestRunner.js'

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
    const zero = new Uint8Array([0x00])
    const zeroAddress = 100
    codeToAddressMap.set(zero, zeroAddress)
    const fff0 = new Uint8Array([0xff, 0xf0])
    const fff0Address = 200
    codeToAddressMap.set(fff0, fff0Address)
    const ff = new Uint8Array([0xff])
    const ffAddress = 300
    codeToAddressMap.set(ff, ffAddress)
    const f0 = new Uint8Array([0xf0])
    const f0Address = 400
    codeToAddressMap.set(f0, f0Address)
    const ffffff = new Uint8Array([0xff, 0xff, 0xff])
    const ffffffAddress = 500
    codeToAddressMap.set(ffffff, ffffffAddress)
    assert.equal(codeToAddressMap.get(zero), zeroAddress)
    assert.equal(codeToAddressMap.get(fff0), fff0Address)
    assert.equal(codeToAddressMap.get(ff), ffAddress)
    assert.equal(codeToAddressMap.get(f0), f0Address)
    assert.equal(codeToAddressMap.get(ffffff), ffffffAddress)

    codeToAddressMap.delete(ffffff)
    assert.equal(codeToAddressMap.get(ffffff), undefined)

    const clonedMap = codeToAddressMap.clone(ffAddress)
    assert.equal(clonedMap.get(zero), zeroAddress)
    assert.equal(clonedMap.get(fff0), fff0Address)
    assert.equal(clonedMap.get(ff), ffAddress)
    assert.equal(clonedMap.get(f0), undefined)
    assert.equal(clonedMap.get(ffffff), undefined)
    const clonedffffffAddress = 600
    clonedMap.set(ffffff, clonedffffffAddress)
    assert.equal(clonedMap.get(ffffff), clonedffffffAddress)
  })
})
