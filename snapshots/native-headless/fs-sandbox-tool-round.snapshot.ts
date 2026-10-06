/** Shipped native-headless filesystem tools record confined writes and denial. */
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/fs-sandbox-tool-round')
const fixture = join(scene, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const task = 'Read seed.txt, create created.txt, edit the seed, then test the sandbox by writing ../../outside.txt.'

it('records confined native file tools and a denied out-of-workspace write through dsh', async () => {
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const initial = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const replayTask = initial?.type === 'user/message' && initial.data.content[0]?.type === 'text'
    ? initial.data.content[0].text : task
  const script = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const base = mkdtempSync(join(homedir(), '.dsh-native-fs-sandbox-'))
  const home = join(base, 'home')
  mkdirSync(home)
  const profile = join(home, 'profiles/native-headless')
  const modules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const audit = join(home, 'model-requests.jsonl')
  const approvals = join(home, 'approval-requests.jsonl')
  const outsidePath = resolve(workspace, '../../outside.txt')
  const links: string[] = []
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'seed.txt'), readFileSync(join(scene, 'workspace/seed.txt'), 'utf8'))
  expect(existsSync(outsidePath)).toBe(false)

  for (const [name, path] of [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'],
    ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
    ['dsh-native-tools', 'rsh/Engine/core/native-tools'],
    ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['dsh-native-prompt', 'rsh/Engine/core/native-prompt'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['dsh-native-sandbox-policy', 'rsh/Modules/Official/sandbox/native-sandbox-policy'],
    ['dsh-fs-sandbox', 'rsh/Modules/Official/fs/fs-sandbox'],
    ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['dsh-native-approval', 'rsh/Modules/Official/interaction/native-approval'],
    ['dsh-tool-fs', 'rsh/Modules/Official/fs/tool-fs'],
  ] as const) {
    const link = join(modules, '@deepseek-ai', name)
    symlinkSync(join(root, path), link, 'junction')
    links.push(link)
  }

  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-headless-fs-sandbox-profile', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  const composition = shippedNativeProfileComposition(home, 'native-headless')
  const selected = new Set(['app', 'agents', 'tools', 'model-execution', 'prompt', 'storage', 'sandbox-policy',
    'fs', 'policy', 'approval', 'file-tools', 'pi-ai'])
  const installations = composition.installations.map((row) => {
    if (!selected.has(row.id)) return { ...row, disabled: true }
    if (row.id === 'app') return { ...row, config: {
      cwd: workspace, provider: 'fixture', model: 'native-fs-sandbox',
      systemPrompt: 'Read and update the workspace files. The sandbox must deny writes outside the workspace.',
      maxSteps: 5, builtinTools: false,
    } }
    if (row.id === 'tools') return { ...row, config: { mode: 'native' } }
    if (row.id === 'storage') return { ...row, config: { root: sessions, compression: 'none' } }
    if (row.id === 'sandbox-policy') return { ...row, config: { mode: 'workspace-write', workspaceRoot: workspace } }
    if (row.id === 'fs') return { ...row, config: { cwd: workspace } }
    if (row.id === 'approval') return { ...row, config: { policy: 'ask' } }
    if (row.id === 'pi-ai') return { id: row.id, plugin: 'native-fs-sandbox-model', scope: row.scope,
      config: { script } }
    return row
  })
  installations.push({ id: 'fixture-approval-answerer', plugin: 'native-fs-sandbox-approval', scope: 'root' })
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations }))

  const model = join(modules, 'native-fs-sandbox-model')
  mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'native-fs-sandbox-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), `import { appendFileSync } from 'node:fs';
export const plugin = { apiVersion: 1, name: 'native-fs-sandbox-model', targets: ['host'], requires: [], provides: ['model'],
 resolve: input => context => { let step = 0; context.provide('model', { async *stream(request) {
  appendFileSync(${JSON.stringify(audit)}, JSON.stringify({ messages: request.messages, tools: request.tools }) + '\\n');
  const script = input.script;
  if (script !== undefined) {
   const entry = script[step++];
   if (entry?.kind !== 'chunks') throw new Error('native filesystem replay exhausted');
   for (const chunk of entry.chunks) yield chunk;
   return;
  }
  const calls = [
   ['read', { file_path: 'seed.txt' }],
   ['write', { file_path: 'created.txt', content: 'created by the native filesystem tool\\n' }],
   ['edit', { file_path: 'seed.txt', old_string: 'before', new_string: 'after', replace_all: false }],
   ['write', { file_path: '../../outside.txt', content: 'must not be written' }],
  ];
  const call = calls[step++];
  if (call !== undefined) {
   yield { type: 'block-start', index: 0, blockType: 'tool-call' };
   yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'native-fs-' + step, name: call[0], arguments: JSON.stringify(call[1]) } };
   yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } else {
   yield { type: 'block-start', index: 0, blockType: 'text' };
   yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Workspace files updated; the outside write was denied.' } };
   yield { type: 'finish', reason: { kind: 'stop' } };
  }
 } }) } }`)

  const answerer = join(modules, 'native-fs-sandbox-approval')
  mkdirSync(answerer)
  writeFileSync(join(answerer, 'package.json'), JSON.stringify({ name: 'native-fs-sandbox-approval', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
  }))
  writeFileSync(join(answerer, 'native.mjs'), `import { appendFileSync } from 'node:fs';
export const plugin = { apiVersion: 1, name: 'native-fs-sandbox-approval', targets: ['host'], requires: ['approval'], provides: [],
 resolve: () => context => { const approval = context.require('approval');
  context.effect(approval.registerAnswerer(request => {
   appendFileSync(${JSON.stringify(approvals)}, JSON.stringify({ toolName: request.toolName, policy: request.policy }) + '\\n');
   return 'allowed-once';
  }));
 } }`)

  try {
    const child = await execa(process.execPath, [
      '--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', replayTask,
    ], { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    expect(child.stdout).toBe('Workspace files updated; the outside write was denied.')
    expect(readFileSync(join(workspace, 'seed.txt'), 'utf8')).toBe('after\n')
    expect(readFileSync(join(workspace, 'created.txt'), 'utf8')).toBe('created by the native filesystem tool\n')
    expect(existsSync(outsidePath)).toBe(false)

    const requests = readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      readonly tools: readonly { readonly name: string }[]
    })
    expect(requests).toHaveLength(5)
    expect(requests[0]?.tools.map(tool => tool.name).sort()).toEqual(['edit', 'read', 'write'])
    expect(readFileSync(approvals, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      readonly toolName: string
      readonly policy: string
    })).toEqual([
      { toolName: 'write', policy: 'ask' },
      { toolName: 'edit', policy: 'ask' },
      { toolName: 'write', policy: 'ask' },
    ])

    const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('native-fs-sandbox: missing Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const calls = events.filter(event => event.type === 'tool/call')
        const results = events.filter(event => event.type === 'tool/result')
        expect(calls.map(event => event.data.name)).toEqual(['read', 'write', 'edit', 'write'])
        expect(results).toHaveLength(4)
        expect(results.filter(event => event.data.message.content.some(block => block.type === 'tool-result' && block.isError))).toHaveLength(1)
        expect(JSON.stringify(results.at(-1))).toContain('FS_SANDBOX_DENIED')
        expect(JSON.stringify(results.at(-1))).toContain('[sandbox: file access denied under workspace-write mode]')
        expect(events.filter(event => event.type === 'native-approval/asked')).toHaveLength(3)
        expect(events.filter(event => event.type === 'native-approval/decided' && event.data.outcome === 'allowed-once')).toHaveLength(3)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      } finally { await reader.close() }
    } finally { await storage.close() }

    const stored = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
    if (stored === undefined) throw new Error('native-fs-sandbox: missing Session JSONL')
    raw = readFileSync(join(sessions, String(stored)), 'utf8')
    const context = { cwd: workspace, sessionIds: [] }
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('native-fs-sandbox: missing model header')
    const output = {
      [fixture]: normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' }),
      [join(scene, 'system-prompt.expected.md')]: formatSystemPromptSnapshot(prompts[0], prompts.slice(1)),
      [join(scene, 'tool-schemas.expected.json')]: formatToolSchemasSnapshot(schemas[0], schemas.slice(1)),
    }
    for (const [path, value] of Object.entries(output)) {
      if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(path, value)
      else expect(value).toBe(readFileSync(path, 'utf8'))
    }
    expect(readFileSync(join(workspace, 'seed.txt'), 'utf8')).toBe(readFileSync(join(scene, 'workspace.expected/seed.txt'), 'utf8'))
    expect(readFileSync(join(workspace, 'created.txt'), 'utf8')).toBe(readFileSync(join(scene, 'workspace.expected/created.txt'), 'utf8'))
  } finally {
    const status = lstatSync(base)
    if (!status.isDirectory() || status.isSymbolicLink() || !basename(base).startsWith('.dsh-native-fs-sandbox-')
      || dirname(realpathSync(base)) !== realpathSync(homedir()) || realpathSync(base) !== resolve(base)) {
      throw new Error('native-fs-sandbox: unsafe temporary base')
    }
    for (const link of links) unlinkSync(link)
    rmSync(base, { recursive: true, force: true })
  }
}, 60_000)
