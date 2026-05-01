import WebSocket from 'ws'
import { hexToBytes, bytesToHex } from './utils.js'

// Compressed secp256k1 public keys are always 33 bytes (0x02 or 0x03 prefix).
// Binary frames are prefixed with the raw key bytes so each chunk can be routed
// to the correct repository without any per-connection state table.
const KEY_BYTES = 33

/**
 * Attach bidirectional multi-repository sync to an already-open WebSocket.
 *
 * Protocol (after the "registry" handshake):
 *   Text frames — JSON control messages:
 *     { type: "catalog", keys: ["hex1", "hex2", ...] }  announce available repos
 *     { type: "subscribe", key: "hex1" }                 request + offer sync for a key
 *
 *   Binary frames — [33-byte pubkey prefix][stream chunk]
 *     The prefix identifies which repository the chunk belongs to.
 *
 * A "subscribe" message is bilateral: the sender will stream their copy of the
 * key to the peer AND expects the peer to stream back.  Both sides accept
 * incoming chunks via makeVerifiedWritableStream so only correctly-signed data
 * is accepted.
 *
 * @param {WebSocket} ws                    already-open WebSocket instance
 * @param {import('./RepositoryRegistry.js').RepositoryRegistry} registry
 * @param {(keyHex: string) => boolean} [filter]  return true to subscribe to a key
 * @param {string} [label]                  prefix for log messages
 */
export function handleRegistryPeer (ws, registry, filter = () => true, label = 'registry') {
  const readers = new Map()        // keyHex → ReadableStreamDefaultReader (we → peer)
  const writers = new Map()        // keyHex → WritableStreamDefaultWriter (peer → us)
  const pendingChunks = new Map()  // keyHex → Uint8Array[] (buffered while writer opens)

  function sendJson (msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  function sendCatalog () {
    const keys = [...registry].map(([k]) => k)
    sendJson({ type: 'catalog', keys })
  }

  function handleWriteError (keyHex, e) {
    console.error(`[${label}] rejected chunk for ${keyHex.slice(0, 8)}...: ${e.message}`)
    ws.close()
  }

  /**
   * Ensure full bidirectional sync is active for keyHex.
   * Idempotent — safe to call multiple times for the same key.
   */
  async function syncKey (keyHex) {
    const repo = await registry.open(keyHex)

    // We → peer: replay all existing chunks then stream new ones
    if (!readers.has(keyHex)) {
      const keyBytes = hexToBytes(keyHex)
      const reader = repo.makeReadableStream().getReader()
      readers.set(keyHex, reader)
      ;(async () => {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (ws.readyState === ws.OPEN) {
              const frame = new Uint8Array(KEY_BYTES + value.length)
              frame.set(keyBytes, 0)
              frame.set(value, KEY_BYTES)
              ws.send(frame)
            } else break
          }
        } catch {}
      })()
    }

    // Peer → us: accept verified chunks; drain anything buffered during setup
    if (!writers.has(keyHex)) {
      const publicKey = hexToBytes(keyHex)
      const writer = repo.makeVerifiedWritableStream(publicKey).getWriter()
      writers.set(keyHex, writer)
      const pending = pendingChunks.get(keyHex) ?? []
      pendingChunks.delete(keyHex)
      for (const chunk of pending) {
        writer.write(chunk).catch(e => handleWriteError(keyHex, e))
      }
    }
  }

  /**
   * Subscribe to keyHex from the peer: set up local sync then announce intent.
   * Sending "subscribe" before streaming ensures the peer has its writer ready
   * before our chunks arrive.
   */
  async function subscribeToKey (keyHex) {
    if (writers.has(keyHex)) return  // already subscribed
    sendJson({ type: 'subscribe', key: keyHex })
    await syncKey(keyHex)
  }

  // When our registry gains a new repo, update the peer's catalog view
  const onNewRepo = () => sendCatalog()
  registry.onOpen(onNewRepo)

  // Announce what we already have
  sendCatalog()

  ws.on('message', async data => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (!buf.length) return

    if (buf[0] === 0x7B) {
      // JSON control message ('{' = 0x7B; secp256k1 keys start with 0x02 or 0x03)
      try {
        const msg = JSON.parse(buf.toString())
        if (msg.type === 'catalog') {
          for (const key of msg.keys) {
            if (filter(key)) await subscribeToKey(key)
          }
        } else if (msg.type === 'subscribe') {
          await syncKey(msg.key)
        }
      } catch (e) {
        console.error(`[${label}] bad control message: ${e.message}`)
      }
    } else {
      // Binary frame: [33-byte key prefix][chunk]
      if (buf.length <= KEY_BYTES) return
      const keyHex = bytesToHex(buf.slice(0, KEY_BYTES))
      const chunk = new Uint8Array(buf.slice(KEY_BYTES))
      const writer = writers.get(keyHex)
      if (writer) {
        writer.write(chunk).catch(e => handleWriteError(keyHex, e))
      } else {
        // Writer is being set up asynchronously — buffer until ready
        if (!pendingChunks.has(keyHex)) pendingChunks.set(keyHex, [])
        pendingChunks.get(keyHex).push(chunk)
      }
    }
  })

  function cleanup () {
    registry.offOpen(onNewRepo)
    for (const reader of readers.values()) reader.cancel().catch(() => {})
  }

  ws.on('close', cleanup)
  ws.on('error', err => {
    console.error(`[${label}] connection error: ${err.message}`)
    cleanup()
  })
}

/**
 * Connect a local RegistryRegistry to a remote one and sync repositories.
 *
 * Sends "registry" as the handshake (instead of a single hex key), then
 * negotiates which repositories to sync via catalog/subscribe messages.
 *
 * @param {import('./RepositoryRegistry.js').RepositoryRegistry} registry
 * @param {string} host
 * @param {number} port
 * @param {(keyHex: string) => boolean} [filter]  return true to subscribe to a key
 * @returns {Promise<WebSocket>}  resolves when the connection is open and sync has started
 */
export function registrySync (registry, host, port, filter = () => true) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}`)

    ws.on('open', () => {
      ws.send('registry')
      handleRegistryPeer(ws, registry, filter, 'origin-registry')
      resolve(ws)
    })

    ws.on('error', reject)
  })
}
