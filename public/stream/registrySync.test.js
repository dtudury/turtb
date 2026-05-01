import { WebSocketServer } from 'ws'
import { describe } from './utils/testing.js'
import { Repository } from './Repository.js'
import { RepositoryRegistry } from './RepositoryRegistry.js'
import { attachStreamSync } from './outletSync.js'
import { registrySync } from './registrySync.js'

// makeVerifiedWritableStream only rejects invalid SIGNATURE chunks —
// plain data chunks pass through even with fake keys.  33 bytes = compressed pubkey size.
const fakeKey = (n = 0) => '02' + n.toString(16).padStart(2, '0').repeat(32)  // 66-char hex

/** Wait up to `ms` ms for `fn()` to return truthy, polling every 10 ms. */
function waitFor (fn, ms = 500) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = () => {
      const v = fn()
      if (v) return resolve(v)
      if (Date.now() - start > ms) return reject(new Error('waitFor timeout'))
      setTimeout(poll, 10)
    }
    poll()
  })
}

/** Start a WebSocketServer on a random port backed by a registry. */
function startServer (registry) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 })
    wss.on('listening', () => {
      const { port } = wss.address()
      attachStreamSync(wss, registry, 'test-outlet')
      resolve({ wss, port })
    })
    wss.on('error', reject)
  })
}

describe(import.meta.url, ({ test }) => {
  test('onOpen fires after registry.open resolves', async ({ assert }) => {
    const registry = new RepositoryRegistry()
    const calls = []
    registry.onOpen((key, repo) => calls.push({ key, repo }))
    const repo = await registry.open('abc')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].key, 'abc')
    assert.ok(calls[0].repo === repo)
  })

  test('offOpen removes the callback', async ({ assert }) => {
    const registry = new RepositoryRegistry()
    let count = 0
    const cb = () => count++
    registry.onOpen(cb)
    await registry.open('x')
    registry.offOpen(cb)
    await registry.open('y')
    assert.equal(count, 1)
  })

  test('onOpen not called for already-open key (concurrent open)', async ({ assert }) => {
    const registry = new RepositoryRegistry()
    let count = 0
    registry.onOpen(() => count++)
    await Promise.all([registry.open('k'), registry.open('k'), registry.open('k')])
    assert.equal(count, 1)
  })

  test('two registries sync an existing repo via registrySync', async ({ assert }) => {
    const serverRegistry = new RepositoryRegistry()
    const { wss, port } = await startServer(serverRegistry)

    const keyHex = fakeKey(1)
    const serverRepo = await serverRegistry.open(keyHex)
    serverRepo.set({ hello: 'world' })

    const clientRegistry = new RepositoryRegistry()
    const ws = await registrySync(clientRegistry, 'localhost', port, k => k === keyHex)

    // Client learns about keyHex via catalog and subscribes
    await waitFor(() => clientRegistry.get(keyHex)?.get('hello') === 'world')
    assert.equal(clientRegistry.get(keyHex).get('hello'), 'world')

    ws.close()
    await new Promise(r => wss.close(r))
  })

  test('changes on server after connect are synced to client', async ({ assert }) => {
    const serverRegistry = new RepositoryRegistry()
    const { wss, port } = await startServer(serverRegistry)

    const keyHex = fakeKey(2)
    const serverRepo = await serverRegistry.open(keyHex)
    serverRepo.set({ v: 1 })

    const clientRegistry = new RepositoryRegistry()
    const ws = await registrySync(clientRegistry, 'localhost', port, k => k === keyHex)

    // Wait for initial sync
    await waitFor(() => clientRegistry.get(keyHex)?.get('v') === 1)

    // Update server-side
    serverRepo.set({ v: 2 })
    await waitFor(() => clientRegistry.get(keyHex)?.get('v') === 2)
    assert.equal(clientRegistry.get(keyHex).get('v'), 2)

    ws.close()
    await new Promise(r => wss.close(r))
  })

  test('newly opened server repos are announced and synced', async ({ assert }) => {
    const serverRegistry = new RepositoryRegistry()
    const { wss, port } = await startServer(serverRegistry)

    const keyHex = fakeKey(3)
    const clientRegistry = new RepositoryRegistry()
    const ws = await registrySync(clientRegistry, 'localhost', port)

    // Open the repo on the server AFTER the client is connected
    const serverRepo = await serverRegistry.open(keyHex)
    serverRepo.set({ late: true })

    // Client should receive the catalog update and subscribe automatically
    await waitFor(() => clientRegistry.get(keyHex)?.get('late') === true)
    assert.equal(clientRegistry.get(keyHex).get('late'), true)

    ws.close()
    await new Promise(r => wss.close(r))
  })

  test('filter prevents unwanted repos from syncing', async ({ assert }) => {
    const serverRegistry = new RepositoryRegistry()
    const { wss, port } = await startServer(serverRegistry)

    const keyA = fakeKey(4)
    const keyB = fakeKey(5)

    const repoA = await serverRegistry.open(keyA)
    repoA.set({ name: 'a' })
    const repoB = await serverRegistry.open(keyB)
    repoB.set({ name: 'b' })

    const clientRegistry = new RepositoryRegistry()
    // Only subscribe to keyA
    const ws = await registrySync(clientRegistry, 'localhost', port, k => k === keyA)

    await waitFor(() => clientRegistry.get(keyA)?.get('name') === 'a')
    assert.equal(clientRegistry.get(keyA).get('name'), 'a')

    // Give keyB time to potentially sync (it should not)
    await new Promise(r => setTimeout(r, 100))
    assert.equal(clientRegistry.get(keyB), undefined, 'keyB was filtered out')

    ws.close()
    await new Promise(r => wss.close(r))
  })

  test('two peers with different repos each sync both after connecting', async ({ assert }) => {
    // Peer A has keyA, Peer B has keyB.  After connecting, both should have both.
    const registryA = new RepositoryRegistry()
    const registryB = new RepositoryRegistry()

    const keyA = fakeKey(6)
    const keyB = fakeKey(7)

    const repoA = await registryA.open(keyA)
    repoA.set({ owner: 'A' })
    const repoB = await registryB.open(keyB)
    repoB.set({ owner: 'B' })

    const { wss, port } = await startServer(registryA)
    const ws = await registrySync(registryB, 'localhost', port)

    await waitFor(() => registryA.get(keyB)?.get('owner') === 'B')
    await waitFor(() => registryB.get(keyA)?.get('owner') === 'A')

    assert.equal(registryA.get(keyB).get('owner'), 'B')
    assert.equal(registryB.get(keyA).get('owner'), 'A')

    ws.close()
    await new Promise(r => wss.close(r))
  })
})
