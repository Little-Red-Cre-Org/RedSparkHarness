/** Built dsh entry executes a native headless profile with only its model substituted. */
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas, sessionFixtureName,
} from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bin = join(root, 'rsh/Programs/CLI/lib/bin.js')
const contextProbe = fileURLToPath(new URL('../../rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs', import.meta.url))
const contextProbeUrl = pathToFileURL(contextProbe).href
const scenario = join(root, 'snapshots/native-headless/file-round')
const shippedProfile = join(root, 'rsh/Programs/CLI/tests/profiles/native-headless')

it('executes and restores a native profile through the published dsh command', async () => {
  if (!existsSync(bin)) throw new Error('build dsh before running built-native-profile.e2e.ts')
  const home = mkdtempSync(join(tmpdir(), 'dsh-built-native-'))
  const profileDir = join(home, 'profiles', 'native-headless')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const modelAudit = join(home, 'model-requests.jsonl')
  const patchPath = join(home, 'native-file-round.patch.json')
  const modules = join(profileDir, 'node_modules')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  copyFileSync(join(shippedProfile, 'package.json'), join(profileDir, 'package.json'))
  copyFileSync(join(shippedProfile, 'rsh.profile.json'), join(profileDir, 'rsh.profile.json'))
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  for (const [name, path] of [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'],
    ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'],
    ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
  ] as const) {
    symlinkSync(join(root, path), join(modules, '@deepseek-ai', name), 'junction')
  }
  const modelDir = join(modules, 'native-fixture-model')
  mkdirSync(modelDir)
  writeFileSync(join(modelDir, 'package.json'), JSON.stringify({
    name: 'native-fixture-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(modelDir, 'native.mjs'), `import { appendFileSync } from 'node:fs';
    export const plugin = { apiVersion: 1, name: 'native-fixture-model', targets: ['host'], requires: [], provides: ['model'],
      resolve: () => context => context.provide('model', { async *stream(request) {
        appendFileSync(${JSON.stringify(modelAudit)}, JSON.stringify({ messages: request.messages, tools: request.tools }) + '\\n');
        if (process.env.NATIVE_FIXTURE_CANCEL === '1') {
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text: 'partial' };
          await new Promise((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('model cancelled')), { once: true });
            queueMicrotask(() => process.emit('SIGTERM'));
          });
          return;
        }
        const hasResult = request.messages.some(message => message.content.some(block => block.type === 'tool-result'));
        if (!hasResult) {
          const call = { type: 'tool-call', id: 'file-1', name: 'write_file', arguments: JSON.stringify({ path: 'created.txt', content: 'from-native-profile\\n' }) };
          yield { type: 'block-start', index: 0, blockType: 'tool-call' };
          yield { type: 'block-end', index: 0, block: call };
          yield { type: 'finish', reason: { kind: 'tool-calls' } };
        } else {
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }
      } }) }
  `)
  const patch = { formatVersion: 1, installations: [
    { id: 'app', config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Use the filesystem tool.', maxSteps: 3 } },
    { id: 'storage', config: { root: sessionRoot, compression: 'none' } },
    { id: 'fs', config: { cwd: workspace } },
  ] }
  writeFileSync(patchPath, JSON.stringify(patch))
  const env = { ...process.env, DSH_HOME: home }
  const invoke = (args: string[], extraEnv: Record<string, string> = {}) => execa(process.execPath, ['--import', contextProbeUrl, bin, '--profile', 'native-headless', '--patch', patchPath, ...args], {
    env: { ...env, ...extraEnv }, reject: false, timeout: 30_000,
  })
  try {
    const negativeControl = await execa(process.execPath, [
      '--import', contextProbeUrl, '--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(join(root, 'rsh/Core/vendor/cordis/lib/index.js')).href)}).then(({ Context }) => new Context())`,
    ], { cwd: root, reject: false })
    expect(negativeControl.exitCode).not.toBe(0)
    expect(negativeControl.stderr).toContain('CORDIS_CONTEXT_CONSTRUCTED')
    const first = await invoke(['create', 'the', 'file'])
    expect(first.exitCode, first.stderr).toBe(0)
    expect(first.stdout).toBe('done')
    expect(readFileSync(join(workspace, 'created.txt'), 'utf8')).toBe('from-native-profile\n')
    const requests = readFileSync(modelAudit, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      messages: { content: { type: string }[] }[]; tools: { name: string }[]
    })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.tools.map(tool => tool.name)).toContain('write_file')
    expect(requests[1]?.messages.some(message => message.content.some(block => block.type === 'tool-result'))).toBe(true)
    const storage = new JsonlSessionBackend({ root: sessionRoot, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('native profile did not persist a Session')
      const second = await invoke(['--resume', id, 'continue'])
      expect(second.exitCode, second.stderr).toBe(0)
      const reader = await storage.open(id, 'read')
      try {
        expect((await reader.read()).events.filter(event => event.type === 'turn/end')).toHaveLength(2)
      } finally { await reader.close() }
      const currentName = sessionFixtureName(0, SESSION_FORMAT_VERSION)
      const storedName = readdirSync(sessionRoot, { recursive: true })
        .find((name): name is string => typeof name === 'string' && name.endsWith(currentName))
      if (storedName === undefined) throw new Error('native profile did not write current Session JSONL')
      const raw = readFileSync(join(sessionRoot, storedName), 'utf8')
      const context = { sessionIds: [id], cwd: workspace }
      const normalized = normalizeSessionSnapshot(
        redactSessionSnapshotIds([raw])[0] ?? raw,
        { ...context, sessionIds: [] },
        { identityMode: 'preserve' },
      )
      if (normalized === undefined) throw new Error('Session snapshot normalization returned no output')
      const prompts = normalizedSystemPrompts(raw, context)
      const schemas = normalizedToolSchemas(raw, context)
      if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native profile omitted its request header')
      if (process.env.DSH_SNAPSHOT === 'refresh') {
        writeFileSync(join(scenario, currentName), normalized)
        writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
        writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
      } else {
        expect(normalized).toBe(readFileSync(join(scenario, currentName), 'utf8'))
      }
      expect(readFileSync(join(workspace, 'created.txt'), 'utf8'))
        .toBe(readFileSync(join(scenario, 'workspace.expected/created.txt'), 'utf8'))
      const configPath = patchPath
      const originalConfig = readFileSync(configPath, 'utf8')
      const storedBeforeRefusal = readFileSync(join(sessionRoot, storedName), 'utf8')
      const changed = JSON.parse(originalConfig) as { installations: Array<{ id: string; config?: Record<string, unknown> }> }
      const app = changed.installations.find(row => row.id === 'app')
      if (app?.config === undefined) throw new Error('native profile lost app configuration')
      try {
        app.config.systemPrompt = 'Different instructions.'
        writeFileSync(configPath, JSON.stringify(changed))
        const refused = await invoke(['--resume', id, 'continue'])
        expect(refused.exitCode).not.toBe(0)
        expect(refused.stderr).toContain('systemPrompt differs')
        expect(readFileSync(join(sessionRoot, storedName), 'utf8')).toBe(storedBeforeRefusal)
      } finally {
        writeFileSync(configPath, originalConfig)
      }
      const cancelled = await invoke(['stop', 'safely'], { NATIVE_FIXTURE_CANCEL: '1' })
      expect(cancelled.exitCode, cancelled.stderr).toBe(0)
      const ids = (await storage.list()).map(snapshot => snapshot.header.id)
      expect(ids).toHaveLength(2)
      const cancelledId = ids.find(value => value !== id)
      if (cancelledId === undefined) throw new Error('cancelled Session was not persisted')
      const cancelledReader = await storage.open(cancelledId, 'read')
      try {
        expect((await cancelledReader.read()).events.at(-1)).toMatchObject({
          type: 'turn/end', data: { reason: { kind: 'aborted' } },
        })
      } finally { await cancelledReader.close() }
    } finally { await storage.close() }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}, 60_000)
