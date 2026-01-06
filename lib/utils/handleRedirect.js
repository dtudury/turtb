import { logError } from './logger.js'

/**
 * @typedef {import('../turtle/connections/TurtleDB.js').TurtleDB} TurtleDB
 */

/**
 *
 * @param {URL} url
 * @param {string} address
 * @param {TurtleDB} turtleDB
 * @param {string} publicKey
 * @param {string} turtleDBFolder
 * @param {(href: string) => void} redirect
 * @param {(type: string, body: string) => void} reply
 */
export const handleRedirect = async (url, address, turtleDB, publicKey, turtleDBFolder, redirect, reply) => {
  if (url.endsWith('/')) url = `${url}index.html`
  const type = url.split('.').pop()
  try {
    let directories = url.split('/')
    if (directories[0] === '') directories.shift()
    else throw new Error('url must start with /')
    let urlPublicKey = publicKey
    if (/^[0-9A-Za-z]{50}$/.test(directories[0])) {
      urlPublicKey = directories.shift()
    }
    directories = directories.filter(Boolean)
    const turtleBranch = await turtleDB.summonBoundTurtleBranch(urlPublicKey)
    const body = turtleBranch.lookupFile(directories.join('/'), false, +address)
    if (body) {
      return reply(type, body)
    } else {
      const symlink = turtleBranch.lookupFile(directories[0])?.symlink
      if (symlink) {
        const symlinkPublicKey = symlink.match(/\b(?<publicKey>[0-9A-Za-z]{50})\/?$/)?.groups?.publicKey
        if (symlinkPublicKey) {
          return handleRedirect(`/${directories.slice(1).join('/')}`, address, turtleDB, symlinkPublicKey, turtleDBFolder, redirect, reply)
        }
      }
    }
  } catch (error) {
    logError(() => console.error(error))
  }
  return reply(type, null)
}
