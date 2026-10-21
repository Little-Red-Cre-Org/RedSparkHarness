/** Keyless native terminal tool transcript through a shipped dsh profile. */
import { copyFileSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless/terminal-lifecycle')
const shippedProfile = join(root, 'rsh/Programs/CLI/tests/profiles/native-terminal-lifecycle')
const currentName = sessionFixtureName(0, SESSION_FORMAT_VERSION)

it('records the native terminal lifecycle tool schema and list result', async () => {
  const expected = join(scenario, currentName)
  const recorded = existsSync(expected) ? parseSessionLog(readFileSync(expected, 'utf8')) : undefined
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = input?.type === 'user/message' && input.data.content[0]?.type === 'text'
    ? input.data.content[0].text : 'List my terminal sessions.'
  const script = recorded === undefined ? [
    [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'terminal-list-1', name: 'terminal_list', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
    [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'No terminal sessions are open.' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ] : deriveReplayScript(recorded).map(entry => {
    if (entry.kind !== 'chunks') throw new Error('terminal-lifecycle: expected complete model responses')
    return entry.chunks
  })
  const home = mkdtempSync(join(tmpdir(), 'dsh-terminal-snapshot-'))
  const profile = join(home, 'profiles/native-terminal-lifecycle')
  const modules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const junctions: string[] = []
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  mkdirSync(workspace)
  for (const file of ['package.json', 'rsh.profile.json']) copyFileSync(join(shippedProfile, file), join(profile, file))
  for (const [name, path] of [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'],
    ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
    ['dsh-native-tools', 'rsh/Engine/core/native-tools'],
    ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'],
    ['dsh-subprocess-local', 'rsh/Core/subprocess/subprocess-local'],
    ['dsh-native-sandbox-policy', 'rsh/Modules/Official/sandbox/native-sandbox-policy'],
    ['dsh-terminal', 'rsh/Modules/Official/terminal/terminal'],
    ['dsh-terminal-bash', 'rsh/Modules/Official/terminal/terminal-bash'],
    ['dsh-tool-terminal', 'rsh/Modules/Official/terminal/tool-terminal'],
  ] as const) {
    const junction = join(modules, '@deepseek-ai', name)
    symlinkSync(join(root, path), junction, 'junction')
    junctions.push(junction)
  }
  const model = join(modules, 'native-terminal-fixture-model')
  mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({
    name: 'native-terminal-fixture-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), `const script = ${JSON.stringify(script)};
    export const plugin = { apiVersion: 1, name: 'native-terminal-fixture-model', targets: ['host'], requires: [], provides: ['model'],
      resolve: () => context => context.provide('model', { async *stream() {
        const chunks = script.shift();
        if (chunks === undefined) throw new Error('terminal-lifecycle: model script exhausted');
        for (const chunk of chunks) yield chunk;
      } }) };
  `)
  const patch = join(home, 'patch.json')
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { cwd: workspace, provider: 'fixture', model: 'terminal-list',
      systemPrompt: 'List terminal sessions using terminal_list.', maxSteps: 2, builtinTools: false } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'fs', config: { cwd: workspace } },
    { id: 'sandbox-policy', config: { mode: 'danger-full-access', workspaceRoot: workspace } },
    { id: 'terminal-backend', config: { type: 'shell', shellPath: process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh',
      shellArgs: [], rows: 24, cols: 80, graceMs: 2000 } },
  ] }))
  try {
    const result = await execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-terminal-lifecycle',
      '--patch', patch, task], { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30_000 })
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toBe('No terminal sessions are open.')
    const storedName = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith(currentName))
    if (storedName === undefined) throw new Error('terminal-lifecycle: missing durable Session')
    const raw = readFileSync(join(sessions, String(storedName)), 'utf8')
    const events = parseSessionLog(raw)
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(JSON.stringify(events.filter(event => event.type === 'tool/result'))).toContain('(no terminal sessions)')
    const context = { cwd: workspace, sessionIds: [] }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('terminal-lifecycle: missing request header')
    const prompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const tools = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(expected, normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), prompt)
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), tools)
    } else {
      expect(normalized).toBe(readFileSync(expected, 'utf8'))
      expect(prompt).toBe(readFileSync(join(scenario, 'system-prompt.expected.md'), 'utf8'))
      expect(tools).toBe(readFileSync(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
    }
  } finally {
    if (!lstatSync(home).isDirectory() || dirname(realpathSync(home)) !== realpathSync(tmpdir())) {
      throw new Error(`terminal-lifecycle: refusing to remove changed temp home ${home}`)
    }
    for (const junction of junctions) {
      if (!lstatSync(junction).isSymbolicLink()) throw new Error(`terminal-lifecycle: refusing to remove changed junction ${junction}`)
    }
    for (const junction of junctions) unlinkSync(junction)
    rmSync(home, { recursive: true, force: true })
  }
}, 45_000)
