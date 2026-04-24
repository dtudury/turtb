import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Stream } from './Stream.js'
import { Signer } from './Signer.js'
import { Signature } from './Signature.js'

test('encodes and decodes primitive values', () => {
  const s = new Stream()
  const values = [
    undefined, null, false, true,
    0, 1, 127,
    128, -1, 3.14, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    new Uint8Array([1, 2, 3]),
    new Uint8Array([4, 5, 6, 7]),
    new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    'hello',
    'a longer string that definitely does not fit in four bytes',
    new Date('1969-07-21T22:56:15Z'),
    { a: 1, b: 2, c: 3 },
    { x: 'hello' },
    {},
    [1, 2, 3],
    [],
    ['a', 'b'],
    new Signature(0, new Uint8Array(64))
  ]
  for (const value of values) {
    const code = s.encodeVariable(value)
    const decoded = s.decode(code)
    assert.deepEqual(decoded, value, `round-trips ${Object.prototype.toString.call(value)}`)
  }
})

test('negative addresses for single-byte primitives', () => {
  const s = new Stream()
  for (const v of [undefined, null, false, true, 0, 1, 127]) {
    const code = s.encode(v)
    assert.equal(code.length, 1, `${String(v)} encodes to 1 byte`)
    const addr = -(code[0] + 1)
    assert.ok(addr < 0, `${String(v)} has a negative address`)
    assert.deepEqual(s.decode(addr), v, `negative address resolves back to ${String(v)}`)
  }
})

test('deduplication: same value always gets the same address', () => {
  const s = new Stream()
  const a1 = s.append(s.encode(42))
  s.append(s.encode({ x: 42 }))
  const code42 = s.encode(42)
  assert.equal(s.addressOf(code42), a1, 'second encode of 42 reuses the existing address')
})

test('reactive get/set/watch', async () => {
  const s = new Stream()
  let callCount = 0
  let lastValue

  s.watch('test', () => {
    lastValue = s.get('greeting')
    callCount++
  })
  assert.equal(callCount, 1, 'watch runs immediately')
  assert.equal(lastValue, undefined, 'no value yet')

  s.set({ greeting: 'hello' })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(callCount, 2, 'watch re-ran after set')
  assert.equal(lastValue, 'hello', 'updated value seen')

  s.set('greeting', 'world')
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(callCount, 3, 'watch re-ran after path set')
  assert.equal(lastValue, 'world', 'path update seen')
})

test('asRefs returns addresses for object values and names', () => {
  const s = new Stream()
  const code = s.encode({ a: 1 })

  // asRefs=true: values become addresses, names stay as strings
  const withTrue = s.decode(code, true)
  assert.deepEqual(Object.keys(withTrue), ['a'])
  assert.equal(typeof withTrue.a, 'number', 'value is an address')
  assert.equal(s.decode(withTrue.a), 1, 'address decodes to original value')

  // asRefs=[true, false]: same — value is address, name is string
  const withValueRef = s.decode(code, [true, false])
  assert.equal(typeof withValueRef.a, 'number')
  assert.equal(s.decode(withValueRef.a), 1)

  // asRefs=[false, true]: value decoded, name is address
  const withNameRef = s.decode(code, [false, true])
  assert.deepEqual(Object.values(withNameRef), [1])
  const nameAddr = Number(Object.keys(withNameRef)[0])
  assert.equal(s.decode(nameAddr), 'a', 'key address decodes to the name string')
})

test('sign and verify', async () => {
  const s = new Stream()
  s.set({ hello: 'world' })
  s.set('hello', 'signed')

  const signer = new Signer('alice', 'secret')
  const name = 'my-stream'
  const keys = await signer.keysFor(name)
  const sig = await s.sign(signer, name)

  assert.ok(sig instanceof Signature)
  assert.ok(await s.verify(sig, keys.publicKey), 'signature verifies with correct key')

  const other = new Signer('bob', 'different')
  const otherKeys = await other.keysFor(name)
  assert.ok(!(await s.verify(sig, otherKeys.publicKey)), 'wrong key does not verify')
})

test('clone snapshots state at a given address', () => {
  const s = new Stream()
  s.set({ v: 1 })
  const addr1 = s.byteLength - 1
  s.set({ v: 2 })

  const snap = s.clone(addr1)
  assert.equal(snap.get('v'), 1, 'clone reflects state at snapshot address')
  assert.equal(s.get('v'), 2, 'original still reflects latest state')
})
