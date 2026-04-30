import { describe } from './public/stream/utils/testing.js'
import { Stream } from './public/stream/Stream.js'
import { StreamRegistry } from './public/stream/StreamRegistry.js'
import { archiveSync } from './public/stream/archiveSync.js'
import { webSync } from './public/stream/webSync.js'
import { Signer } from './public/stream/Signer.js'
import WebSocket from 'ws'
import { rm, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

// 1 iteration keeps key derivation fast without compromising what we're testing
const KEY_ITERATIONS = 1
const toHex = bytes => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')

async function makeKey (name = 'smoke') {
  const signer = new Signer('test', 'test', KEY_ITERATIONS)
  const { publicKey } = await signer.keysFor(name)
  return { signer, publicKey, publicKeyHex: toHex(publicKey) }
}

async function startServer (publicKeyHex, stream) {
  const registry = new StreamRegistry(() => stream)
  const server = await webSync(registry, publicKeyHex, 0, 'smoke-test', KEY_ITERATIONS)
  const { port } = server.address()
  const close = () => new Promise(resolve => server.close(resolve))
  return { port, close }
}

describe(import.meta.url, ({ test }) => {
  test('GET /api/info returns primaryKeyHex and name', async ({ assert }) => {
    const { publicKeyHex } = await makeKey()
    const { port, close } = await startServer(publicKeyHex, new Stream())
    try {
      const info = await fetch(`http://localhost:${port}/api/info`).then(r => r.json())
      assert.equal(info.primaryKeyHex, publicKeyHex)
      assert.equal(info.name, 'smoke-test')
    } finally {
      await close()
    }
  })

  test('GET /streams/:key/raw loads into a fresh Stream', async ({ assert }) => {
    const { publicKeyHex } = await makeKey()
    const stream = new Stream()
    stream.set({ hello: 'world' })
    const { port, close } = await startServer(publicKeyHex, stream)
    try {
      const buf = await fetch(`http://localhost:${port}/streams/${publicKeyHex}/raw`)
        .then(r => r.arrayBuffer())
      const fresh = new Stream()
      await fresh.makeWritableStream().getWriter().write(new Uint8Array(buf))
      assert.deepEqual(fresh.get(), { hello: 'world' })
    } finally {
      await close()
    }
  })

  test('WebSocket syncs existing chunks to a connecting client', async ({ assert }) => {
    const { publicKeyHex } = await makeKey()
    const stream = new Stream()
    stream.set({ synced: true })
    const { port, close } = await startServer(publicKeyHex, stream)
    try {
      const client = new Stream()
      const writer = client.makeWritableStream().getWriter()
      const ws = new WebSocket(`ws://localhost:${port}`)

      await new Promise((resolve, reject) => {
        ws.on('open', () => ws.send(publicKeyHex))
        ws.on('message', async data => {
          await writer.write(new Uint8Array(data))
          if (client.byteLength >= stream.byteLength) resolve()
        })
        ws.on('error', reject)
        setTimeout(() => reject(new Error('WS sync timed out')), 2000)
      })

      ws.close()
      assert.deepEqual(client.get(), { synced: true })
    } finally {
      await close()
    }
  })

  test('archiveSync persists data and reloads it on a fresh Stream', async ({ assert }) => {
    const { publicKeyHex } = await makeKey('archive')
    const dir = await mkdtemp(join(tmpdir(), 'smoke-'))
    try {
      const stream1 = new Stream()
      await archiveSync(stream1, dir, publicKeyHex)
      stream1.set({ persisted: true })
      await new Promise(r => setTimeout(r, 100))  // let write loop flush

      const stream2 = new Stream()
      await archiveSync(stream2, dir, publicKeyHex)
      assert.deepEqual(stream2.get(), { persisted: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
