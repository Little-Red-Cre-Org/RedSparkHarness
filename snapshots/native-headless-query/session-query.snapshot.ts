/** Shipped Native session-query profile, model-visible search result and replay. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas, sessionFixtureName,
} from '@deepseek-ai/dsh-session-snapshot'
import { ensureShippedNativeProfile } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless-query/session-query')
const fixturePath = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))

it('records and replays a session search through the shipped Native query profile', async () => {
  const recorded = existsSync(fixturePath) ? parseSessionLog(readFileSync(fixturePath, 'utf8')) : undefined
  const initial = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = initial?.type === 'user/message' && initial.data.content[0]?.type === 'text'
    ? initial.data.content[0].text : 'Search prior sessions for history and report whether any match exists.'
  const script = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-session-query-'))
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const profileDir = join(home, 'profiles', 'native-headless-query')
  const profilePath = join(profileDir, 'rsh.profile.json')
  const patchPath = join(home, 'native-headless-query.patch.json')
  const modules = join(profileDir, 'node_modules')
  try {
    mkdirSync(workspace)
    ensureShippedNativeProfile('native-headless-query', home)
    mkdirSync(modules, { recursive: true })
    const composition = JSON.parse(readFileSync(profilePath, 'utf8')) as {
      installations: Array<{ id: string; plugin: string; scope: string; config?: Record<string, unknown> }>
    }
    const installations = composition.installations.map(row => row.id === 'pi-ai'
      ? { ...row, plugin: 'session-query-model', config: { script } } : row)
    writeFileSync(profilePath, `${JSON.stringify({ ...composition, installations }, null, 2)}\n`)
    writeFileSync(patchPath, `${JSON.stringify({
      formatVersion: 1,
      installations: [
        { id: 'app', config: { cwd: workspace, provider: 'fixture', model: 'session-query', systemPrompt: 'Use session_search to answer the request.', maxSteps: 3 } },
        { id: 'time-context', disabled: true },
      ],
    }, null, 2)}\n`)

    const model = join(modules, 'session-query-model')
    mkdirSync(model)
    writeFileSync(join(model, 'package.json'), JSON.stringify({
      name: 'session-query-model', type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
    }))
    writeFileSync(join(model, 'native.mjs'), `export const plugin = {
  apiVersion: 1, name: 'session-query-model', targets: ['host'], requires: [], provides: ['model'],
  resolve(input) {
    const script = input.script
    return context => {
      let index = 0
      context.provide('model', { async *stream() {
        if (script !== undefined) {
          const entry = script[index++]
          if (entry?.kind !== 'chunks') throw new Error('session-query: replay script exhausted')
          for (const chunk of entry.chunks) yield chunk
          return
        }
        if (index++ === 0) {
          yield { type: 'block-start', index: 0, blockType: 'tool-call' }
          yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'query-1', name: 'session_search', arguments: JSON.stringify({ query: 'history' }) } }
          yield { type: 'finish', reason: { kind: 'tool-calls' } }
          return
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Native session search completed.' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } })
    }
  },
}\n`)

    const child = await execa(process.execPath, [
      '--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless-query', '--patch', patchPath, task,
    ], { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 60_000 })
    expect(child.timedOut, child.stderr).toBe(false)
    expect(child.exitCode, child.stderr).toBe(0)

    const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('session-query: process did not persist a Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const results = events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        expect(results[0]?.data.message.content.every(block => block.type !== 'tool-result' || !block.isError)).toBe(true)
        const text = results[0]?.data.message.content.flatMap(block => block.type === 'tool-result' ? block.content : [])
          .filter(block => block.type === 'text').map(block => block.text).join('')
        expect(text).toContain('No prior session matches found.')
      } finally { await reader.close() }
      const file = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
      if (file === undefined) throw new Error('session-query: missing physical Session')
      raw = readFileSync(join(sessions, String(file)), 'utf8')
    } finally { await storage.close() }

    const context = { sessionIds: [], cwd: workspace }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('session-query: missing request header')
    const prompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const tools = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(fixturePath, normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), prompt)
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), tools)
    } else {
      expect(normalized).toBe(readFileSync(fixturePath, 'utf8'))
      expect(prompt).toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(tools).toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})
