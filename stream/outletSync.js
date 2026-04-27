import { WebSocketServer } from 'ws'

function hexToBytes (hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/**
 * Start a WebSocket server that syncs streams from a StreamRegistry.
 *
 * Protocol:
 *   1. Client sends a text message containing the hex-encoded public key of
 *      the stream it wants to sync.
 *   2. Server opens (or creates) that stream and begins full-duplex sync:
 *        server → client: all existing chunks, then new ones as they arrive
 *        client → server: chunks verified against the stream's public key
 *
 * Duplicate chunks are silently skipped on both sides (content-addressed
 * dedup). Invalid signature chunks close the connection.
 *
 * @param {import('./StreamRegistry.js').StreamRegistry} registry
 * @param {number} port
 * @returns {WebSocketServer}
 */
export function outletSync (registry, port) {
  const wss = new WebSocketServer({ port })

  wss.on('connection', ws => {
    let reader = null

    ws.once('message', async rawHandshake => {
      const publicKeyHex = rawHandshake.toString().trim()

      // Buffer any data frames that arrive while we're opening the stream,
      // so nothing is dropped during the async gap after the handshake.
      const pending = []
      const buffer = data => pending.push(data)
      ws.on('message', buffer)

      let stream
      try {
        stream = await registry.open(publicKeyHex)
      } catch (e) {
        console.error(`[outlet] failed to open stream ${publicKeyHex.slice(0, 8)}...: ${e.message}`)
        ws.close()
        return
      }

      ws.off('message', buffer)

      // Stream → peer: replay all chunks, then stream new ones
      reader = stream.makeReadableStream().getReader()
      ;(async () => {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (ws.readyState === ws.OPEN) ws.send(value)
            else break
          }
        } catch {}
      })()

      // Peer → stream: verify signature chunks before accepting
      const publicKey = hexToBytes(publicKeyHex)
      const writer = stream.makeVerifiedWritableStream(publicKey).getWriter()

      const writeChunk = data => {
        writer.write(new Uint8Array(data)).catch(e => {
          console.error(`[outlet] rejected chunk from ${publicKeyHex.slice(0, 8)}...: ${e.message}`)
          ws.close()
        })
      }

      // Drain buffered frames, then handle live ones
      for (const data of pending) writeChunk(data)
      ws.on('message', writeChunk)
    })

    ws.on('close', () => reader?.cancel().catch(() => {}))
    ws.on('error', err => {
      console.error('[outlet] connection error:', err.message)
      reader?.cancel().catch(() => {})
    })
  })

  return wss
}
