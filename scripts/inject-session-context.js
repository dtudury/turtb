#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook.
 * On the first message of a new session, finds the most recent previous session's
 * JSONL transcript and injects it as additionalContext so Claude has continuity.
 * On subsequent messages it exits immediately without doing anything.
 */
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'

const input = JSON.parse(await new Promise(resolve => {
  let data = ''
  process.stdin.on('data', chunk => (data += chunk))
  process.stdin.on('end', () => resolve(data))
}))

const { transcript_path } = input

// Only inject on the first message of the session (no assistant turns yet)
const currentTranscript = await readFile(transcript_path, 'utf8')
const currentEntries = currentTranscript.trim().split('\n')
  .map(line => { try { return JSON.parse(line) } catch { return null } })
  .filter(Boolean)

if (currentEntries.some(e => e.type === 'assistant')) process.exit(0)

// Find other session JSONLs in the same directory
const sessionsDir = transcript_path.split('/').slice(0, -1).join('/')
const currentFile = transcript_path.split('/').at(-1)
const files = (await readdir(sessionsDir)).filter(f => f.endsWith('.jsonl') && f !== currentFile)

if (!files.length) process.exit(0)

const withMtime = await Promise.all(
  files.map(async name => ({ name, mtime: (await stat(join(sessionsDir, name))).mtimeMs }))
)
withMtime.sort((a, b) => b.mtime - a.mtime) // newest first

// Extract readable turns from the most recent sessions
const MAX_CHARS = 24000
const parts = []

for (const { name } of withMtime.slice(0, 5)) {
  const content = await readFile(join(sessionsDir, name), 'utf8')
  const entries = content.trim().split('\n')
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)

  for (const entry of entries) {
    if (entry.type === 'user' && entry.message?.role === 'user') {
      const raw = entry.message.content
      const text = typeof raw === 'string' ? raw
        : Array.isArray(raw) ? raw.filter(b => b.type === 'text').map(b => b.text).join('') : ''
      if (text && !text.includes('<command-message>') && !text.includes('<system-reminder>')) {
        parts.push(`User: ${text}`)
      }
    } else if (entry.type === 'assistant' && entry.message?.role === 'assistant') {
      const raw = entry.message.content
      const text = Array.isArray(raw)
        ? raw.filter(b => b.type === 'text').map(b => b.text).join('')
        : typeof raw === 'string' ? raw : ''
      if (text) parts.push(`Claude: ${text}`)
    }
  }
}

if (!parts.length) process.exit(0)

let context = parts.join('\n\n')
if (context.length > MAX_CHARS) {
  context = '[earlier conversation truncated]\n\n' + context.slice(-MAX_CHARS)
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    additionalContext: `## Previous session transcript\n\n${context}`
  }
}))
