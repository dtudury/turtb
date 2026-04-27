import { describe } from './utils/testing.js'
import { StreamRegistry } from './StreamRegistry.js'

describe(import.meta.url, ({ test }) => {
  test('open creates a stream and returns the same instance on repeat calls', async ({ assert }) => {
    const registry = new StreamRegistry('/tmp/stream-registry-test-' + Date.now())
    const key = 'aabbcc'
    const s1 = await registry.open(key)
    const s2 = await registry.open(key)
    assert.ok(s1 !== undefined)
    assert.ok(s1 === s2, 'same instance returned')
    assert.equal(registry.size, 1)
  })

  test('open creates independent streams for different keys', async ({ assert }) => {
    const registry = new StreamRegistry('/tmp/stream-registry-test-' + Date.now())
    const s1 = await registry.open('key1')
    const s2 = await registry.open('key2')
    assert.ok(s1 !== s2)
    assert.equal(registry.size, 2)

    s1.set({ from: 'key1' })
    s2.set({ from: 'key2' })
    assert.equal(s1.get('from'), 'key1')
    assert.equal(s2.get('from'), 'key2')
  })

  test('get returns undefined for unopened keys', async ({ assert }) => {
    const registry = new StreamRegistry('/tmp/stream-registry-test-' + Date.now())
    assert.equal(registry.get('nope'), undefined)
    await registry.open('exists')
    assert.ok(registry.get('exists') !== undefined)
    assert.equal(registry.get('nope'), undefined)
  })

  test('iterates over open streams', async ({ assert }) => {
    const registry = new StreamRegistry('/tmp/stream-registry-test-' + Date.now())
    await registry.open('a')
    await registry.open('b')
    const entries = [...registry]
    assert.equal(entries.length, 2)
    assert.deepEqual(entries.map(([k]) => k).sort(), ['a', 'b'])
  })

  test('persists and reloads stream data', async ({ assert }) => {
    const dir = '/tmp/stream-registry-persist-test-' + Date.now()
    const r1 = new StreamRegistry(dir)
    const s1 = await r1.open('testkey')
    s1.set({ saved: true })
    await new Promise(r => setTimeout(r, 50))

    const r2 = new StreamRegistry(dir)
    const s2 = await r2.open('testkey')
    assert.equal(s2.get('saved'), true, 'data survived registry reload')
  })
})
