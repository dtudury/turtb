import WebSocket from 'ws'
import { hexToBytes, bytesToHex } from './utils.js'

// Compressed secp256k1 public keys are always 33 bytes (0x02 or 0x03 prefix).
// Binary frames are prefixed with the raw key bytes so each chunk can be routed
// to the correct repository without any per-connection state table.
const KEY_BYTES = 33

/**
 * @typedef {Object} RegistrySyncOptions
 *
 * @property {(keyHex: string) => boolean} [filter]
 *   Called for each key announced in the peer's catalog.  Return true to
 *   subscribe (and start syncing) that repository.  Defaults to subscribing
 *   to everything.  Keys discovered via `follow` are always subscribed regardless
 *   of this filter — the assumption is that if your own data references a repo
 *   you want it.
 *
 * @property {(keyHex: string, repo: import('./Repository.js').Repository, subscribe: (keyHex: string) => void) => void} [follow]
 *   Called reactively whenever a synced repository's value changes.  Use this
 *   to extract repository keys embedded in the data and call `subscribe(key)`
 *   on each one.  The registry will then sync that repo too, and `follow` will
 *   be called on it in turn — so discovery propagates through the graph.
 *
 *   Example — chat app where the chat repo lists participant keys:
 *
 *     follow: (keyHex, repo, subscribe) => {
 *       for (const memberKey of repo.get('members') ?? []) subscribe(memberKey)
 *     }
 *
 *   `subscribe` is idempotent and safe to call for already-synced repos.
 */

/**
 * Attach bidirectional multi-repository sync to an already-open WebSocket.
 *
 * ## Protocol (after the "registry" text handshake)
 *
 * ### Control messages — JSON text frames
 *
 *   { "type": "catalog", "keys": ["hex1", "hex2", ...] }
 *     Announce the full set of repositories this side currently has open.
 *     Sent once on connect and again whenever a new repo is opened.
 *
 *   { "type": "subscribe", "key": "hex1" }
 *     Request to sync a repository bidirectionally.  The sender will stream
 *     its copy of the repo to the peer AND expects the peer to stream back.
 *     Both sides set up a makeVerifiedWritableStream for the key so only
 *     correctly-signed chunks are accepted.
 *
 * ### Data frames — binary
 *
 *   [33 bytes: compressed secp256k1 public key][N bytes: stream chunk]
 *
 *     The 33-byte prefix identifies which repository the chunk belongs to
 *     (secp256k1 keys always start with 0x02 or 0x03; JSON control messages
 *     always start with 0x7B '{', so the two are unambiguous).
 *     The chunk bytes are taken directly from makeReadableStream() and fed
 *     directly into makeVerifiedWritableStream() on the other side.
 *
 * ## Discovery via `follow`
 *
 * When a `follow` function is provided, it is called via recaller.watch()
 * whenever a synced repository's value changes.  Calling `subscribe(key)` inside
 * `follow` causes that key to be synced too, and `follow` will be called on it
 * in turn.  This lets a graph of related repositories be discovered organically
 * from content — no out-of-band catalog is needed.
 *
 * @param {WebSocket} ws
 * @param {import('./RepositoryRegistry.js').RepositoryRegistry} registry
 * @param {RegistrySyncOptions} [options]
 * @param {string} [label]  prefix for log messages
 */
export function handleRegistryPeer (ws, registry, options = {}, label = 'registry') {
  const { filter = () => true, follow = null } = options

  const readers = new Map()        // keyHex → ReadableStreamDefaultReader (we → peer)
  const writers = new Map()        // keyHex → WritableStreamDefaultWriter (peer → us)
  const pendingChunks = new Map()  // keyHex → Uint8Array[] (buffered while writer opens)
  const followFns = new Map()      // keyHex → fn registered with recaller.watch

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

    // Content-driven discovery: watch this repo's value and subscribe to any
    // keys the `follow` callback extracts from it.  Runs immediately (to catch
    // existing data) and re-runs whenever the repo's value changes.
    if (follow && !followFns.has(keyHex)) {
      const fn = () => follow(keyHex, repo, key => subscribeToKey(key))
      followFns.set(keyHex, fn)
      repo.recaller.watch(`registry-follow:${keyHex}`, fn)
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
    for (const [keyHex, fn] of followFns) {
      registry.get(keyHex)?.recaller.unwatch(fn)
    }
  }

  ws.on('close', cleanup)
  ws.on('error', err => {
    console.error(`[${label}] connection error: ${err.message}`)
    cleanup()
  })
}

/**
 * Connect a local RepositoryRegistry to a remote one and sync repositories.
 *
 * Sends `"registry"` as the WebSocket handshake (instead of a single hex key),
 * then negotiates which repositories to sync via catalog/subscribe messages.
 *
 * ### Basic usage — sync everything
 *
 *   const ws = await registrySync(myRegistry, 'localhost', 8080)
 *
 * ### Catalog filter — subscribe only to specific repos
 *
 *   const ws = await registrySync(myRegistry, 'localhost', 8080, {
 *     filter: key => key === myKeyHex
 *   })
 *
 * ### Content-driven discovery — follow repo references
 *
 * If a repo's value contains keys pointing to other repos, pass a `follow`
 * function and the registry will automatically sync those referenced repos:
 *
 *   const ws = await registrySync(myRegistry, 'localhost', 8080, {
 *     filter: key => key === rootChatKey,
 *     follow: (keyHex, repo, subscribe) => {
 *       // The chat repo stores a list of participant keys in repo.get('members')
 *       for (const memberKey of repo.get('members') ?? []) subscribe(memberKey)
 *     }
 *   })
 *
 * The `follow` callback is called reactively: any time a synced repo's value
 * changes, `follow` re-runs for that repo.  Calling `subscribe(key)` inside
 * `follow` is idempotent — already-synced repos are skipped.
 *
 * Discovery propagates: once a referenced repo is synced, `follow` will also
 * be called on it, so chains of references are followed automatically.
 *
 * @param {import('./RepositoryRegistry.js').RepositoryRegistry} registry
 * @param {string} host
 * @param {number} port
 * @param {RegistrySyncOptions} [options]
 * @returns {Promise<WebSocket>}  resolves when the connection is open and sync has started
 */
export function registrySync (registry, host, port, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}`)

    ws.on('open', () => {
      ws.send('registry')
      handleRegistryPeer(ws, registry, options, 'origin-registry')
      resolve(ws)
    })

    ws.on('error', reject)
  })
}
