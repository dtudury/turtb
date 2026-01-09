#!/usr/bin/env node

import { readFileSync } from 'fs'
import { start } from 'repl'
import { Option, program } from 'commander'
import { keyInSelect, keyInYN, question, questionNewPassword } from 'readline-sync'
import { LOG_LEVELS, logDebug, logError, logInfo, setLogLevel } from '../lib/utils/logger.js'
import { Signer } from '../lib/turtle/Signer.js'
import { TurtleDB } from '../lib/turtle/connections/TurtleDB.js'
import { Recaller } from '../lib/utils/Recaller.js'
import { OURS, THEIRS, THROW, TurtleDictionary } from '../lib/turtle/TurtleDictionary.js'
import { Workspace } from '../lib/turtle/Workspace.js'
import { AS_REFS } from '../lib/turtle/codecs/CodecType.js'
import { archiveSync } from '../src/archiveSync.js'
import { fileSync } from '../src/fileSync.js'
import { s3Sync } from '../src/s3Sync.js'
import { originSync } from '../src/originSync.js'
import { outletSync } from '../src/outletSync.js'
import { webSync } from '../src/webSync.js'
import { config } from 'dotenv'
import { proxyFolder } from '../src/proxyFolder.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const startTime = new Date()
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))

const defaultWebPort = 8080
const defaultRemoteHost = 'turtledb.com'
const defaultRemotePort = 1024
const defaultSyncPort = 1024

const makeParserWithOptions = (...options) => value => {
  if (options.length) {
    if (value === true) return options[0]
    if (value === '') return options[0]
    if (value === 'true') return options[0]
  }
  if (value === 'false') return false
  if (!isNaN(+value)) value = +value
  if (options.length <= 1 || options.includes(value)) return value
  throw new Error(`value must be one of: ${options.join(', ')}`)
}

const optionNameToEnvName = {
  turtlename: 'TURTLEDB_TURTLENAME',
  username: 'TURTLEDB_USERNAME',
  password: 'TURTLEDB_PASSWORD',
  fsMirror: 'TURTLEDB_FS_MIRROR',
  interactive: 'TURTLEDB_INTERACTIVE',
  archive: 'TURTLEDB_ARCHIVE',
  verbose: 'TURTLEDB_VERBOSE',
  turtleDBFolder: 'TURTLEDB_FOLDER',
  webPort: 'TURTLEDB_WEB_PORT',
  webCertpath: 'TURTLEDB_WEB_CERTPATH',
  webInsecure: 'TURTLEDB_WEB_INSECURE',
  remoteHost: 'TURTLEDB_REMOTE_HOST',
  remotePort: 'TURTLEDB_REMOTE_PORT',
  syncPort: 'TURTLEDB_PORT',
  s3EndPoint: 'TURTLEDB_S3_END_POINT',
  s3Region: 'TURTLEDB_S3_REGION',
  s3AccessKeyId: 'TURTLEDB_S3_ACCESS_KEY_ID',
  s3SecretAccessKey: 'TURTLEDB_S3_SECRET_ACCESS_KEY',
  s3Bucket: 'TURTLEDB_S3_BUCKET'
}

program
  .name('turtledb-com')
  .version(version)

  .option('--env-file <path>', 'path to .env file')

  .addOption(
    new Option('--turtlename <string>', 'name for dataset')
      .env(optionNameToEnvName.turtlename)
  )
  .addOption(
    new Option('--username <string>', 'username to use for Signer')
      .env(optionNameToEnvName.username)
  )
  .addOption(
    new Option('--password <string>', 'password to use for Signer')
      .env(optionNameToEnvName.password)
  )

  .addOption(
    new Option('-f, --fs-mirror [resolve]', 'mirror files locally and handle')
      .default(false)
      .preset(THROW)
      .choices([OURS, THEIRS, THROW, ''])
      .argParser(makeParserWithOptions(THROW, OURS, THEIRS))
      .env(optionNameToEnvName.fsMirror)
  )
  .addOption(
    new Option('-i, --interactive', 'flag to start repl')
      .default(false)
      .preset(true)
      .env(optionNameToEnvName.interactive)
  )
  .addOption(
    new Option('-a, --archive', 'save all turtles to files by public key')
      .default(false)
      .preset(true)
      .env(optionNameToEnvName.archive)
  )
  .addOption(
    new Option('-v, --verbose [level]', 'log data flows')
      .default(0)
      .preset(1)
      .choices(Object.values(LOG_LEVELS).map(v => v.toString()))
      .argParser(makeParserWithOptions(1, ...Object.values(LOG_LEVELS)))
      .env(optionNameToEnvName.verbose)
  )
  .addOption(
    new Option('--turtleDB-folder <path>', 'path to folder for TurtleDB files')
      .default('.turtleDB')
      .env(optionNameToEnvName.turtleDBFolder)
  )

  .addOption(
    new Option('-w, --web-port [number]', 'web port to sync from')
      .default(false)
      .preset(defaultWebPort)
      .argParser(makeParserWithOptions(defaultWebPort))
      .env(optionNameToEnvName.webPort)
      .helpGroup('Web Server:')
  )
  .addOption(
    new Option('--web-certpath <string>', 'path to self-cert for web')
      .default(false)
      .env(optionNameToEnvName.webCertpath)
      .helpGroup('Web Server:')
  )
  .addOption(
    new Option('--web-insecure', '(local dev) allow unauthorized for web')
      .default(false)
      .preset(true)
      .env(optionNameToEnvName.webInsecure)
      .helpGroup('Web Server:')
  )

  .addOption(
    new Option('--remote-host [string]', 'remote host to sync to')
      .default(false)
      .preset(defaultRemoteHost)
      .argParser(makeParserWithOptions(defaultRemoteHost))
      .env(optionNameToEnvName.remoteHost)
      .helpGroup('TurtleDB Syncing:')
  )
  .addOption(
    new Option('-r, --remote-port [number]', 'remote port to sync to')
      .default(false)
      .preset(defaultRemotePort)
      .argParser(makeParserWithOptions(defaultRemotePort))
      .env(optionNameToEnvName.remotePort)
      .helpGroup('TurtleDB Syncing:')
  )

  .addOption(
    new Option('-p, --sync-port [number]', 'local port to sync from')
      .default(false)
      .preset(defaultSyncPort)
      .argParser(makeParserWithOptions(defaultSyncPort))
      .env(optionNameToEnvName.syncPort)
      .helpGroup('TurtleDB Syncing:')
  )

  .addOption(
    new Option('--s3-end-point <string>', 'endpoint for s3 (like "https://sfo3.digitaloceanspaces.com")')
      .default(false)
      .argParser(makeParserWithOptions())
      .env(optionNameToEnvName.s3EndPoint)
      .helpGroup('S3-like Service Syncing:')
  )
  .addOption(
    new Option('--s3-region <string>', 'region for s3 (like "sfo3")')
      .default(false)
      .env(optionNameToEnvName.s3Region)
      .helpGroup('S3-like Service Syncing:')
  )
  .addOption(
    new Option('--s3-access-key-id <string>', 'accessKeyId for s3')
      .default(false)
      .env(optionNameToEnvName.s3AccessKeyId)
      .helpGroup('S3-like Service Syncing:')
  )
  .addOption(
    new Option('--s3-secret-access-key <string>', 'secretAccessKey for s3')
      .default(false)
      .env(optionNameToEnvName.s3SecretAccessKey)
      .helpGroup('S3-like Service Syncing:')
  )
  .addOption(
    new Option('--s3-bucket <string>', 'bucket for s3')
      .default(false)
      .env(optionNameToEnvName.s3Bucket)
      .helpGroup('S3-like Service Syncing:')
  )

  .parse()

const optionsByName = Object.fromEntries(
  Object.entries(optionNameToEnvName).map(([optionName, envName]) => [
    optionName,
    program.options.find(option => option.envVar === envName)
  ])
)

const options = program.opts()
if (options.envFile) {
  config({ path: options.envFile })
  program.parse() // re-parse with new env vars
  Object.assign(options, program.opts()) // update options with new env vars
}
setLogLevel(options.verbose)
logInfo(() => console.log())
logInfo(() => console.log(`\x1b[32mturtb v${version}\x1b[0m`))
logInfo(() => console.log(`\x1b[96m${startTime.toLocaleString()} \x1b[2m(${startTime.toISOString()})\x1b[0m`))
logInfo(() => console.log())
options.turtlename ||= question('Turtlename: ')
options.username ||= question('Username: ')
const turtlename = options.turtlename
const username = options.username
const signer = new Signer(username, options.password || questionNewPassword('Password [ATTENTION!: Backspace won\'t work here]: ', { min: 4, max: 999 }))
const publicKey = (await signer.makeKeysFor(turtlename)).publicKey
logInfo(() => {
  const maxLength = Math.max(turtlename.length, username.length, publicKey.length)
  console.log(`\x1b[35m
    ╭─────────────────────────${'─'.repeat(maxLength)}──╮
    ╞══════════════════════╤══${'═'.repeat(maxLength)}══╡
    │          TURTLENAME: │  \x1b[0m${turtlename}${' '.repeat(maxLength - turtlename.length)}\x1b[35m  │
    ├──────────────────────┼──${'─'.repeat(maxLength)}──┤
    │            USERNAME: │  \x1b[0m${username}${' '.repeat(maxLength - username.length)}\x1b[35m  │
    ├──────────────────────┼──${'─'.repeat(maxLength)}──┤
    │  COMPACT PUBLIC KEY: │  \x1b[0m${publicKey}${' '.repeat(maxLength - publicKey.length)}\x1b[35m  │
    ╰━━━━━━━━━━━━━━━━━━━━━━┷━━${'━'.repeat(maxLength)}━━╯\x1b[0m`)
})

let initOption = -1
if (!options.envFile) {
  initOption = keyInSelect([
    '.env file only',
    '.env, package.json, LICENSE, and .gitignore'
  ], 'Create (replace existing) files for easier startup?', { cancel: 'CANCEL: Don\'t create any files' })
}
const willSync = options.syncPort || options.remoteHost || options.remotePort || options.s3EndPoint || options.archive || options.fsMirror || options.webPort || options.interactive
if (!willSync) {
  if (keyInYN(`Mirror local files as state (${optionsByName.fsMirror.envVar})?`)) {
    options.fsMirror = optionsByName.fsMirror.presetArg
  }
  if (keyInYN(`Start localhost web server(${optionsByName.webPort.envVar})?`)) {
    options.webPort = optionsByName.webPort.presetArg
  }
  if (keyInYN(`Sync with remote turtle (${optionsByName.remoteHost.envVar} and ${optionsByName.remotePort.envVar})?`)) {
    options.remoteHost = optionsByName.remoteHost.presetArg
    options.remotePort = optionsByName.remotePort.presetArg
  }
  if (keyInYN(`Archive changes (${optionsByName.archive.envVar})?`)) {
    options.archive = optionsByName.archive.presetArg
  }
  if (keyInYN(`Interactive mode (${optionsByName.interactive.envVar})?`)) {
    options.interactive = optionsByName.interactive.presetArg
  }
}
if (initOption !== -1) {
  const folder = proxyFolder('.')
  const optionsAsEnv = Object.entries(optionsByName).map(([name, option]) => {
    const value = options[name]
    if (!option.envVar) return null
    if (option.defaultValue === value) return `# ${option.envVar}=`
    if (option.presetArg === value) return `${option.envVar}=`
    return `${option.envVar}=${value}`
  })
  console.log(optionsAsEnv.join('\n'))
  folder['.env'] = optionsAsEnv
  if (initOption > 0) {
    folder['package.json'] = {
      name: options.turtlename,
      author: options.username,
      license: 'AGPL-3.0-only',
      scripts: {
        start: 'npx turtb --env-file .env'
      }
    }
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    folder.LICENSE = readFileSync(join(__dirname, '../LICENSE'), { encoding: 'utf8' }).split(/\n/)
    folder['.gitignore'] = [
      '# don\'t commit passwords',
      '.env*',
      '',
      '# devDependencies... DEV ONLY! if your app needs it don\t .gitignore it, maybe copy it out of node_modules post-install?',
      'node_modules/',
      '',
      '# turtleDB uses this file and should ignore git stuff',
      '.git/',
      '',
      '# git uses this file and should ignore turtleDB stuff',
      '.turtleDB/',
      '',
      '# Optional REPL history',
      '.node_repl_history',
      '',
      '# the true price of a pretty laptop',
      '**/.DS_Store'
    ]
  }
}

// console.log({ options })
logDebug(() => console.log({ options }))
// process.exit(0)

const recaller = new Recaller('turtledb-com')
const turtleDB = new TurtleDB('turtledb-com', recaller)

if (options.syncPort) {
  const syncPort = +options.syncPort || defaultSyncPort
  logInfo(() => console.log(`listening for local connections on port ${syncPort}`))
  outletSync(turtleDB, syncPort)
}

if (options.remoteHost || options.remotePort) {
  const remoteHost = options.remoteHost || defaultRemoteHost
  const remotePort = +options.remotePort || defaultRemotePort
  logInfo(() => console.log(`connecting to remote at ${remoteHost}:${remotePort}`))
  originSync(turtleDB, remoteHost, remotePort)
}

if (options.s3EndPoint) {
  s3Sync(turtleDB, recaller, options.s3EndPoint, options.s3Region, options.s3AccessKeyId, options.s3SecretAccessKey, options.s3Bucket)
}

if (options.archive) {
  const archivePath = `${options.turtleDBFolder}/archive`
  logInfo(() => console.log(`archiving to ${archivePath}`))
  archiveSync(turtleDB, recaller, archivePath)
}

if (options.fsMirror) {
  if (![OURS, THEIRS, THROW].includes(options.fsMirror)) {
    logError(() => console.error(`fs-mirror resolve option must be "${OURS}", "${THEIRS}" or "${THROW}" (you provided: "${options.fsMirror}")`))
    process.exit(1)
  }
  logInfo(() => console.log('mirroring to file system'))
  fileSync(turtlename, turtleDB, signer, undefined, options.fsMirror, options.turtleDBFolder)
}

if (options.webPort) {
  const webPort = +options.webPort
  const insecure = !!options.webInsecure
  const https = insecure || !!options.webCertpath
  const certpath = options.webCertpath || `${options.turtleDBFolder}/dev/cert.json`
  logInfo(() => console.log(`listening for web connections on port ${webPort} (https: ${https}, insecure: ${insecure}, certpath: ${certpath})`))
  webSync(webPort, publicKey, turtleDB, https, insecure, certpath, options.turtleDBFolder)
}

if (options.interactive) {
  global.username = username
  global.turtlename = turtlename
  global.signer = signer
  global.publicKey = publicKey
  global.recaller = recaller
  global.turtleDB = turtleDB
  global.workspace = await turtleDB.makeWorkspace(signer, turtlename)
  global.TurtleDictionary = TurtleDictionary
  global.Signer = Signer
  global.Workspace = Workspace
  global.setLogLevel = setLogLevel
  global.AS_REFS = AS_REFS
  const replServer = start({ breakEvalOnSigint: true })
  replServer.setupHistory('.node_repl_history', err => {
    if (err) logError(() => console.error(err))
  })
  replServer.on('exit', process.exit)
}
