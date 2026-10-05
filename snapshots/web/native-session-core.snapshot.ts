/** Native Web Session RPC records a keyless turn through the published dsh profile launcher. */
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { normalizeSessionSnapshot, redactSessionSnapshotIds, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/web/native-session-core')

it('records a native browser Session turn through dsh native-web', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-web-profile-'))
  const profile = join(home, 'profiles/native-web')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  mkdirSync(profile, { recursive: true })
  mkdirSync(workspace)
  const modules = join(profile, 'node_modules/@deepseek-ai')
  mkdirSync(modules, { recursive: true })
  const links: string[] = []
  for (const [name, path] of [
    ['native-web-host', 'Programs/Web/host/native-web-host'],
    ['native-web-session-controller', 'Programs/Web/api/native-web-session-controller'],
    ['client-connection', 'Programs/Web/client/connection'],
    ['client-native-session', 'Programs/Web/client/native-session'],
    ['credentials-local', 'Modules/Official/credentials/credentials-local'],
    ['native-agent', 'Engine/core/native-agent'],
    ['native-session-execution', 'Engine/core/native-session-execution'],
    ['native-model-execution', 'Engine/core/native-model-execution'],
    ['fs-local', 'Modules/Official/fs/fs-local'],
    ['session-persistence-jsonl', 'Engine/session/session-persistence-jsonl'],
  ] as const) {
    const link = join(modules, `dsh-${name}`)
    symlinkSync(join(root, 'rsh', path), link, 'junction')
    links.push(link)
  }
  const fixtureModel = join(profile, 'node_modules/native-web-fixture-model')
  mkdirSync(fixtureModel)
  writeFileSync(join(fixtureModel, 'package.json'), JSON.stringify({
    name: 'native-web-fixture-model', type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(fixtureModel, 'native.mjs'), `export const plugin = {
    apiVersion: 1, name: 'native-web-fixture-model', targets: ['host'], requires: [], provides: ['model'],
    resolve: () => context => context.provide('model', { async *stream() {
      const text = 'Native browser answer.';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } }) };`)
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-web-snapshot', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  writeFileSync(join(profile, 'rsh.client.json'), JSON.stringify({ formatVersion: 1, installations: [
    { id: 'connection', plugin: '@deepseek-ai/dsh-client-connection' },
    { id: 'session', plugin: '@deepseek-ai/dsh-client-native-session' },
  ] }))
  const shipped = shippedNativeProfileComposition(home, 'native-web')
  const app = shipped.installations.find(row => row.id === 'app')
  if (app?.config === undefined) throw new Error('shipped native-web has no Host settings')
  const rows = [
    ['app', 'native-web-host', { ...app.config as object, port: 0 }],
    ['sessions', 'native-web-session-controller', { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Answer the user.',
      maxSteps: 1, maxPendingRequests: 8, maxHistoryEvents: 100, maxPromptChars: 100 }],
    ['agents', 'native-agent'], ['execution', 'native-session-execution'], ['model-execution', 'native-model-execution'],
    ['fs', 'fs-local', { cwd: workspace }], ['storage', 'session-persistence-jsonl', { root: sessionRoot, compression: 'none' }],
    ['credentials', 'credentials-local', { path: join(home, 'credentials.json') }],
  ] as const
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1, scopes: [{ id: 'root' }], installations: [
    ...rows.map(([id, name, config]) => ({ id, plugin: `@deepseek-ai/dsh-${name}`, scope: 'root', ...config === undefined ? {} : { config } })),
    { id: 'model', plugin: 'native-web-fixture-model', scope: 'root' },
  ] }))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-web'], {
    cwd: root, env: { ...process.env, DSH_HOME: home }, reject: false,
  })
  try {
    const address = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('native Web did not announce its URL')), 30_000)
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString()
        const url = /http:\/\/[^\s]+\n/.exec(output)?.[0].trim()
        if (url !== undefined) { clearTimeout(timeout); resolve(url) }
      })
      void child.then(result => { clearTimeout(timeout); reject(new Error(`native Web exited: ${result.stderr}`)) })
    })
    const login = await fetch(address, { redirect: 'manual' })
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    if (cookie === undefined) throw new Error('native Web did not authenticate')
    const fixture = process.env.DSH_SNAPSHOT === 'refresh' ? undefined
      : readFileSync(join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION)), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { type?: string; data?: { content?: { type: string; text?: string }[] } })
    const text = fixture === undefined ? 'Native browser input.'
      : fixture.find(event => event.type === 'user/message')?.data?.content?.find(block => block.type === 'text')?.text
    if (text === undefined) throw new Error('recorded browser Session has no human input')
    const response = await fetch(new URL('/api/session/prompt', address), { method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: 'native-web-1', method: 'session/prompt', payload: { sessionId: 'native-web-recorded', text, resume: false } }) })
    const reply = await response.json()
    if (!reply.result.ok) throw new Error(JSON.stringify(reply.result.error))
    expect(reply).toMatchObject({ result: { ok: true, value: { exitCode: 0, answer: 'Native browser answer.' } } })
    const storage = new JsonlSessionBackend({ root: sessionRoot, compression: 'none' })
    {
      const entries = await storage.list()
      expect(entries).toHaveLength(1)
      const id = entries[0]!.header.id
      const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
      const stored = readdirSync(sessionRoot, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
      if (typeof stored !== 'string') throw new Error('native Web omitted Session JSONL')
      const raw = readFileSync(join(sessionRoot, stored), 'utf8')
      const context = { sessionIds: [id], cwd: workspace }
      const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, { ...context, sessionIds: [] }, { identityMode: 'preserve' })
      if (normalized === undefined) throw new Error('missing normalized Session')
      const prompts = normalizedSystemPrompts(raw, context)
      const schemas = normalizedToolSchemas(raw, context)
      if (process.env.DSH_SNAPSHOT === 'refresh') {
        mkdirSync(scenario, { recursive: true })
        writeFileSync(join(scenario, name), normalized)
        writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)))
        writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)))
      } else expect(normalized).toBe(readFileSync(join(scenario, name), 'utf8'))
    }
  } finally {
    child.kill('SIGTERM')
    await child
    // Check every junction before unlinking; never recurse into a linked workspace.
    if (dirname(realpathSync(home)) !== realpathSync(tmpdir()) || lstatSync(home).isSymbolicLink()) throw new Error('unexpected snapshot home')
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('snapshot package link was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true })
  }
}, 45_000)
