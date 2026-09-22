/** Built dsh profile adapts selected Cordis filesystem contributions into one native Session. */
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const scenario = join(root, 'snapshots/compat/file-round')
const shippedProfile = join(root, 'rsh/Programs/CLI/tests/profiles/compat')

it('adapts legacy file tools through a shipped profile and writes one durable result', async () => {
  if (!existsSync(bin)) throw new Error('build dsh before running compat.snapshot.ts')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-compat-'))
  const profileDir = join(home, 'profiles', 'compat')
  const workspace = join(home, 'work')
  const sessionRoot = join(home, 'sessions')
  const modelAudit = join(home, 'model-requests.jsonl')
  const patchPath = join(home, 'compat.patch.json')
  const modules = join(profileDir, 'node_modules')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  copyFileSync(join(shippedProfile, 'package.json'), join(profileDir, 'package.json'))
  copyFileSync(join(shippedProfile, 'rsh.profile.json'), join(profileDir, 'rsh.profile.json'))
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  for (const [name, path] of [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['dsh-compat-fs-local', 'rsh/Compatibility/DSH/bridge/compat-fs-local'],
    ['dsh-compat-fs-policy', 'rsh/Compatibility/DSH/bridge/compat-fs-policy'],
    ['dsh-native-tools', 'rsh/Engine/core/native-tools'],
    ['dsh-native-prompt', 'rsh/Engine/core/native-prompt'],
    ['dsh-compat-tool-fs', 'rsh/Compatibility/DSH/bridge/compat-tool-fs'],
  ] as const) symlinkSync(join(root, path), join(modules, '@deepseek-ai', name), 'junction')
  const modelDir = join(modules, 'native-compat-fixture-model')
  mkdirSync(modelDir)
  writeFileSync(join(modelDir, 'package.json'), JSON.stringify({
    name: 'native-compat-fixture-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(modelDir, 'native.mjs'), `import { appendFileSync } from 'node:fs';
    export const plugin = { apiVersion: 1, name: 'native-compat-fixture-model', targets: ['host'], requires: [], provides: ['model'],
      resolve: () => context => context.provide('model', { async *stream(request) {
        appendFileSync(${JSON.stringify(modelAudit)}, JSON.stringify({ messages: request.messages, tools: request.tools }) + '\\n');
        const hasResult = request.messages.some(message => message.content.some(block => block.type === 'tool-result'));
        if (!hasResult) {
          const call = { type: 'tool-call', id: 'compat-write-1', name: 'write', arguments: JSON.stringify({ file_path: 'created.txt', content: 'from-compat-profile\\n' }) };
          yield { type: 'block-start', index: 0, blockType: 'tool-call' };
          yield { type: 'block-end', index: 0, block: call };
          yield { type: 'finish', reason: { kind: 'tool-calls' } };
        } else {
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'block-end', index: 0, block: { type: 'text', text: 'compat done' } };
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
  try {
    const run = await execa(process.execPath, [bin, '--profile', 'compat', '--patch', patchPath, 'create', 'the', 'file'], {
      env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30_000,
    })
    expect(run.exitCode, run.stderr).toBe(0)
    expect(run.stdout).toBe('compat done')
    expect(readFileSync(join(workspace, 'created.txt'), 'utf8')).toBe('from-compat-profile\n')
    const requests = readFileSync(modelAudit, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      messages: { content: { type: string }[] }[]; tools: { name: string }[]
    })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.tools.map(tool => tool.name)).toContain('write')
    expect(requests[0]?.messages[0]?.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Use the write tool') })
    const storage = new JsonlSessionBackend({ root: sessionRoot, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('compat profile did not persist a Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        expect(events.filter(event => event.type === 'tool/call')).toHaveLength(1)
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
      } finally { await reader.close() }
      const currentName = sessionFixtureName(0, SESSION_FORMAT_VERSION)
      const storedName = readdirSync(sessionRoot, { recursive: true })
        .find((name): name is string => typeof name === 'string' && name.endsWith(currentName))
      if (storedName === undefined) throw new Error('compat profile did not write current Session JSONL')
      const raw = readFileSync(join(sessionRoot, storedName), 'utf8')
      const context = { sessionIds: [id], cwd: workspace }
      const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, { ...context, sessionIds: [] }, { identityMode: 'preserve' })
      if (normalized === undefined) throw new Error('Session snapshot normalization returned no output')
      const prompts = normalizedSystemPrompts(raw, context)
      const schemas = normalizedToolSchemas(raw, context)
      if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('compat profile omitted its request header')
      if (process.env.DSH_SNAPSHOT === 'refresh') {
        writeFileSync(join(scenario, currentName), normalized)
        writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1)))
        writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1)))
      } else {
        expect(normalized).toBe(readFileSync(join(scenario, currentName), 'utf8'))
      }
      expect(readFileSync(join(workspace, 'created.txt'), 'utf8'))
        .toBe(readFileSync(join(scenario, 'workspace.expected/created.txt'), 'utf8'))
    } finally { await storage.close() }
  } finally { rmSync(home, { recursive: true, force: true }) }
}, 60_000)
