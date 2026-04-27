import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import express from 'express'

function hexToBytes (hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/**
 * Start an HTTP + WebSocket server that exposes a StreamRegistry to browsers
 * and other peers.
 *
 * HTTP endpoints:
 *   GET /                         → 200 JSON: current value of the primary stream
 *   GET /streams/:key             → 200 JSON: current value of stream `key`
 *   GET /streams/:key/raw         → 200 application/octet-stream: full wire-format archive
 *
 * WebSocket (same port, upgraded from HTTP):
 *   Uses the same handshake + full-duplex wire protocol as outletSync, so any
 *   originSync client can connect here directly.
 *
 * @param {import('./StreamRegistry.js').StreamRegistry} registry
 * @param {string} primaryKeyHex   public key of the "main" stream for GET /
 * @param {number} port
 * @returns {Promise<import('http').Server>}
 */
export async function webSync (registry, primaryKeyHex, port) {
  const app = express()

  // Current value of the primary stream as JSON
  app.get('/', async (req, res) => {
    try {
      const stream = await registry.open(primaryKeyHex)
      res.json(stream.byteLength > 0 ? stream.get() : null)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Current value of any stream as JSON
  app.get('/streams/:key', async (req, res) => {
    try {
      const stream = await registry.open(req.params.key)
      res.json(stream.byteLength > 0 ? stream.get() : null)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Full wire-format archive for a stream (useful for bulk transfer / debugging)
  app.get('/streams/:key/raw', async (req, res) => {
    try {
      const stream = await registry.open(req.params.key)
      res.set('Content-Type', 'application/octet-stream')
      const reader = stream.makeReadableStream().getReader()
      res.on('close', () => reader.cancel().catch(() => {}))
      const pump = async () => {
        const { value, done } = await reader.read()
        if (done || !res.writable) return
        res.write(Buffer.from(value))
        pump()
      }
      pump()
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  const server = createServer(app)

  // WebSocket sync on the same port — same protocol as outletSync
  const wss = new WebSocketServer({ server })
  wss.on('connection', ws => {
    let reader = null

    ws.once('message', async rawHandshake => {
      const publicKeyHex = rawHandshake.toString().trim()

      const pending = []
      const buffer = data => pending.push(data)
      ws.on('message', buffer)

      let stream
      try {
        stream = await registry.open(publicKeyHex)
      } catch (e) {
        console.error(`[web] failed to open stream ${publicKeyHex.slice(0, 8)}...: ${e.message}`)
        ws.close()
        return
      }

      ws.off('message', buffer)

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

      const publicKey = hexToBytes(publicKeyHex)
      const writer = stream.makeVerifiedWritableStream(publicKey).getWriter()

      const writeChunk = data => {
        writer.write(new Uint8Array(data)).catch(e => {
          console.error(`[web] rejected chunk from ${publicKeyHex.slice(0, 8)}...: ${e.message}`)
          ws.close()
        })
      }

      for (const data of pending) writeChunk(data)
      ws.on('message', writeChunk)
    })

    ws.on('close', () => reader?.cancel().catch(() => {}))
    ws.on('error', err => {
      console.error('[web] connection error:', err.message)
      reader?.cancel().catch(() => {})
    })
  })

  await new Promise((resolve, reject) => {
    server.listen(port, err => err ? reject(err) : resolve())
  })

  return server
}
