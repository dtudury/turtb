#!/usr/bin/env node

import { readFileSync } from 'fs'
import { Option, program } from 'commander'
import { config } from 'dotenv'
import { question, questionNewPassword } from 'readline-sync'
import { start as startRepl } from 'repl'
import { Signer } from '../public/stream/Signer.js'
import { Stream } from '../public/stream/Stream.js'
import { Repository } from '../public/stream/Repository.js'
import { StreamRegistry } from '../public/stream/StreamRegistry.js'
import { archiveSync } from '../public/stream/archiveSync.js'
import { fileSync } from '../public/stream/fileSync.js'
import { outletSync } from '../public/stream/outletSync.js'
import { originSync } from '../public/stream/originSync.js'
import { webSync } from '../public/stream/webSync.js'
import { s3Sync } from '../public/stream/s3Sync.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))

program
  .name('stream')
  .description('turtb stream CLI')
  .version(version)

  .addOption(
    new Option('--env-file <path>', 'path to .env file')
  )
  .addOption(
    new Option('--name <string>', 'name for this dataset')
      .env('STREAM_NAME')
  )
  .addOption(
    new Option('--username <string>', 'username for signing')
      .env('STREAM_USERNAME')
  )
  .addOption(
    new Option('--password <string>', 'password for signing')
      .env('STREAM_PASSWORD')
  )
  .addOption(
    new Option('--data-dir <path>', 'directory for archive files')
      .env('STREAM_DATA_DIR')
      .default('.stream')
  )
  .addOption(
    new Option('--files [path]', 'mirror local files to/from stream (defaults to current directory)')
      .env('STREAM_FILES')
      .preset('.')
  )
  .addOption(
    new Option('--s3-bucket <name>', 'S3 bucket name')
      .env('STREAM_S3_BUCKET')
  )
  .addOption(
    new Option('--s3-endpoint <url>', 'S3-compatible endpoint (omit for AWS)')
      .env('STREAM_S3_ENDPOINT')
  )
  .addOption(
    new Option('--s3-region <region>', 'S3 region')
      .env('STREAM_S3_REGION')
  )
  .addOption(
    new Option('--s3-access-key-id <id>', 'S3 access key ID')
      .env('STREAM_S3_ACCESS_KEY_ID')
  )
  .addOption(
    new Option('--s3-secret-access-key <key>', 'S3 secret access key')
      .env('STREAM_S3_SECRET_ACCESS_KEY')
  )
  .addOption(
    new Option('--web [port]', 'start HTTP + WebSocket server for browsers and peers')
      .env('STREAM_WEB')
      .preset('8080')
  )
  .addOption(
    new Option('--outlet [port]', 'accept inbound WebSocket peer connections')
      .env('STREAM_OUTLET')
      .preset('1024')
  )
  .addOption(
    new Option('--origin <host:port>', 'connect to a remote outlet')
      .env('STREAM_ORIGIN')
  )
  .addOption(
    new Option('--interactive', 'start a REPL with stream, signer, and helpers as globals')
      .env('STREAM_INTERACTIVE')
  )
  .addOption(
    new Option('--key-iterations <number>', 'PBKDF2 iterations for key derivation (lower = faster startup, less secure)')
      .env('STREAM_KEY_ITERATIONS')
      .default(100000)
      .argParser(Number)
  )
  .addOption(
    new Option('--verbose', 'enable verbose logging')
      .env('STREAM_VERBOSE')
  )

  .parse()

const options = program.opts()

if (options.envFile) {
  config({ path: options.envFile })
  program.parse()
  Object.assign(options, program.opts())
}

options.name ||= question('Name: ')
options.username ||= question('Username: ')
const password = options.password || questionNewPassword('Password [ATTENTION!: Backspace won\'t work here]: ', { min: 4, max: 999 })

const signer = new Signer(options.username, password, options.keyIterations)
const { publicKey } = await signer.keysFor(options.name)
const publicKeyHex = Array.from(publicKey).map(b => b.toString(16).padStart(2, '0')).join('')

const name = options.name
const username = options.username
const webUrl = options.web ? `http://localhost:${+options.web}` : null
const rows = [
  ['NAME', name],
  ['USERNAME', username],
  ['PUBLIC KEY', publicKeyHex],
  ...(webUrl ? [['URL', webUrl]] : []),
]
const maxLength = Math.max(...rows.map(([, v]) => v.length))
const pad = (v) => v + ' '.repeat(maxLength - v.length)
const div = '─'.repeat(maxLength)
const label = (l) => l.padStart(16)
console.log(`\x1b[35m
    ╭──────────────────${'─'.repeat(div.length)}──╮
    ╞══════════════════╤══${'═'.repeat(maxLength)}══╡
${rows.map(([l, v], i) => [
  `    │  ${label(l + ':')} │  \x1b[0m${pad(v)}\x1b[35m  │`,
  i < rows.length - 1 ? `    ├──────────────────┼──${div}──┤` : null
].filter(Boolean).join('\n')).join('\n')}
    ╰──────────────────┴──${'━'.repeat(maxLength)}──╯\x1b[0m`)

const dataDir = options.dataDir
const registry = new StreamRegistry(async key => {
  const stream = options.files ? new Repository() : new Stream()
  await archiveSync(stream, dataDir, key)
  return stream
})
const stream = await registry.open(publicKeyHex)

if (options.files) {
  const folder = typeof options.files === 'string' ? options.files : '.'
  await fileSync(stream, folder, options.dataDir)
  console.log(`\x1b[32mmirroring files: ${folder}\x1b[0m`)
}

if (options.s3Bucket) {
  await s3Sync(stream, publicKeyHex, {
    bucket: options.s3Bucket,
    endpoint: options.s3Endpoint,
    region: options.s3Region,
    accessKeyId: options.s3AccessKeyId,
    secretAccessKey: options.s3SecretAccessKey
  })
  console.log(`\x1b[32ms3: syncing to bucket ${options.s3Bucket}\x1b[0m`)
}

if (options.web) {
  await webSync(registry, publicKeyHex, +options.web, name, options.keyIterations)
}

if (options.outlet) {
  const port = +options.outlet
  outletSync(registry, port)
  console.log(`\x1b[32moutlet: listening on port ${port}\x1b[0m`)
}

if (options.origin) {
  const [host, port] = options.origin.split(':')
  await originSync(stream, publicKeyHex, host, +port)
  console.log(`\x1b[32morigin: connected to ${options.origin}\x1b[0m`)
}

if (options.verbose) {
  console.log(`archive: ${options.dataDir}/${publicKeyHex}.bin (${stream.byteLength} bytes loaded)`)
  console.log({ options })
}

if (options.interactive) {
  const get = (...args) => stream.get(...args)
  const set = (...args) => stream.set(...args)
  const ls = () => [...registry].map(([k, s]) => ({ key: k.slice(0, 8) + '…', bytes: s.byteLength }))
  const connect = (hostPort) => {
    const [host, port] = hostPort.split(':')
    return originSync(stream, publicKeyHex, host, +port)
  }

  Object.assign(globalThis, {
    // identity
    name, username, publicKeyHex, signer,
    // data
    stream, registry,
    // shorthands
    get, set, ls,
    // networking
    connect, originSync, outletSync,
    // sync modules
    archiveSync, fileSync, s3Sync,
    // class
    Stream, StreamRegistry,
  })

  console.log(`\x1b[36m
  get(...path)          stream.get() — read a value by path
  set(value)            stream.set() — write a value
  ls()                  list all open streams in the registry
  connect('host:port')  connect this stream to a remote outlet
  stream / registry     the live stream and registry instances
  signer                sign / verify data
  originSync(s,k,h,p)   attach any stream as an origin
  outletSync(reg,port)  start a new outlet server\x1b[0m`)

  const replServer = startRepl({ breakEvalOnSigint: true })
  replServer.setupHistory('.node_repl_history', err => {
    if (err) console.error(err)
  })
  replServer.on('exit', process.exit)
}
