import { describe } from './utils/testing.js'
import { Stream } from './Stream.js'
import { stateSync } from './stateSync.js'
import { readFile, writeFile, rm } from 'fs/promises'
import { existsSync } from 'fs'

const tmp = () => `/tmp/stateSync-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`

describe(import.meta.url, ({ test }) => {
  test('writes stream state to file on startup', async ({ assert }) => {
    const path = tmp()
    const stream = new Stream()
    stream.set({ x: 1 })
    await stateSync(stream, path)
    const content = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(content, { x: 1 })
    await rm(path, { force: true })
  })

  test('loads file into empty stream on startup', async ({ assert }) => {
    const path = tmp()
    await writeFile(path, JSON.stringify({ y: 42 }), 'utf8')
    const stream = new Stream()
    await stateSync(stream, path)
    assert.deepEqual(stream.get(), { y: 42 })
    await rm(path, { force: true })
  })

  test('stream updates are written to file', async ({ assert }) => {
    const path = tmp()
    const stream = new Stream()
    stream.set({ count: 0 })
    await stateSync(stream, path)

    stream.set({ count: 1 })
    await new Promise(r => setTimeout(r, 50))

    const content = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(content.count, 1)
    await rm(path, { force: true })
  })

  test('file changes update the stream', async ({ assert }) => {
    const path = tmp()
    const stream = new Stream()
    stream.set({ count: 0 })
    await stateSync(stream, path)

    await writeFile(path, JSON.stringify({ count: 99 }), 'utf8')
    await new Promise(r => setTimeout(r, 100))

    assert.equal(stream.get('count'), 99)
    await rm(path, { force: true })
  })

  test('stream wins over absent file on startup', async ({ assert }) => {
    const path = tmp()
    const stream = new Stream()
    stream.set({ from: 'stream' })
    await stateSync(stream, path)
    assert.deepEqual(stream.get(), { from: 'stream' })
    assert.ok(existsSync(path))
    await rm(path, { force: true })
  })

  test('does not corrupt stream if json file is invalid', async ({ assert }) => {
    const path = tmp()
    await writeFile(path, 'not json', 'utf8')
    const stream = new Stream()
    stream.set({ safe: true })
    await stateSync(stream, path)
    assert.equal(stream.get('safe'), true)
    await rm(path, { force: true })
  })
})
