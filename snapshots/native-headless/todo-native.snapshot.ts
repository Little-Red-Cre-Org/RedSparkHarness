/** Real native todo calls, durable Session ordering and cold projection. */
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { readTodos } from '@deepseek-ai/dsh-tool-todo/native'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/todo-native')

it('commits todo replacement before the next model request and restores the same standing plan', async () => {
  const fixture = join(scene, 'session.v3.jsonl')
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const initial = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = initial?.type === 'user/message' && initial.data.content[0]?.type === 'text'
    ? initial.data.content[0].text : 'Plan and finish the task.'
  const script = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const home = mkdtempSync(join(tmpdir(), 'dsh-todo-native-'))
  const profile = join(home, 'profiles/native-headless')
  const modules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const audit = join(home, 'audit.jsonl')
  const links: string[] = []
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  mkdirSync(workspace)
  const packages = [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'], ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
    ['dsh-native-tools', 'rsh/Engine/core/native-tools'], ['dsh-native-session-execution', 'rsh/Engine/core/native-session-execution'], ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'], ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['dsh-tool-todo', 'rsh/Modules/Official/todo/tool-todo'],
  ] as const
  for (const [name, path] of packages) {
    const link = join(modules, '@deepseek-ai', name)
    symlinkSync(join(root, path), link, 'junction'); links.push(link)
  }
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-headless-profile', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1, scopes: [{ id: 'root' }], installations: [
    { id: 'app', plugin: '@deepseek-ai/dsh-native-headless', scope: 'root', config: {
      cwd: workspace, provider: 'mock', model: 'todo', systemPrompt: 'Maintain the task list.', maxSteps: 3,
    } },
    ...[['agents', 'dsh-native-agent'], ['tools', 'dsh-native-tools'], ['execution', 'dsh-native-model-execution'], ['sessions', 'dsh-native-session-execution'],
      ['policy', 'dsh-fs-observation-policy']].map(([id, pkg]) => ({ id, plugin: '@deepseek-ai/' + pkg, scope: 'root',
      ...(id === 'tools' ? { config: { mode: 'native' } } : {}) })),
    { id: 'storage', plugin: '@deepseek-ai/dsh-session-persistence-jsonl', scope: 'root', config: { root: sessions, compression: 'none' } },
    { id: 'fs', plugin: '@deepseek-ai/dsh-fs-local', scope: 'root', config: { cwd: workspace } },
    { id: 'todo', plugin: '@deepseek-ai/dsh-tool-todo', scope: 'root', config: { allowParallelInProgress: false } },
    { id: 'model', plugin: 'todo-model', scope: 'root' },
  ] }))
  const model = join(modules, 'todo-model'); mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'todo-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(model, 'native.mjs'), `import { appendFileSync } from 'node:fs';
export const plugin = { apiVersion: 1, name: 'todo-model', targets: ['host'], requires: [], provides: ['model'],
 resolve: () => context => { let step = 0; context.provide('model', { async *stream(request) {
  appendFileSync(${JSON.stringify(audit)}, JSON.stringify(request.messages) + '\\n');
  if (${JSON.stringify(script)} !== undefined) {
   const entry = ${JSON.stringify(script)}[step++];
   if (entry?.kind !== 'chunks') throw new Error('todo replay exhausted');
   for (const chunk of entry.chunks) yield chunk;
  } else if (++step <= 2) {
   yield { type: 'block-start', index: 0, blockType: 'tool-call' };
   yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'todo-' + step, name: 'todo_write',
    arguments: JSON.stringify({ todos: [{ content: ' Implement native todo ', status: step === 1 ? 'in_progress' : 'completed' }] }) } };
   yield { type: 'finish', reason: { kind: 'tool-calls' } };
  } else {
   yield { type: 'block-start', index: 0, blockType: 'text' };
   yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Todo complete.' } };
   yield { type: 'finish', reason: { kind: 'stop' } };
  }
 } }) } }`)
  try {
    const child = await execa(process.execPath, ['--import', pathToFileURL(join(root,
      'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', task],
    { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    const requests = readFileSync(audit, 'utf8').trim().split('\n')
    expect(requests).toHaveLength(3)
    expect(requests[1]).toContain('1 in progress')
    expect(requests[2]).toContain('1 completed')
    const backend = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await backend.list())[0]?.header.id
      if (id === undefined) throw new Error('todo-native: missing Session')
      const reader = await backend.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const writes = events.filter(event => event.type === 'todo/write')
        expect(writes).toHaveLength(2)
        expect(events.indexOf(writes[0]!)).toBeLessThan(events.findIndex(event => event.type === 'tool/result'))
        expect(await readTodos({ readEvents: async () => events } as Parameters<typeof readTodos>[0], new AbortController().signal))
          .toEqual([{ content: 'Implement native todo', status: 'completed' }])
      } finally { await reader.close() }
    } finally { await backend.close() }
    const file = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (file === undefined) throw new Error('todo-native: missing Session file')
    const raw = readFileSync(join(sessions, String(file)), 'utf8')
    const context = { sessionIds: [], cwd: workspace }
    const prompts = normalizedSystemPrompts(raw, context); const schemas = normalizedToolSchemas(raw, context)
    const outputs = {
      'session.v3.jsonl': normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' }),
      'system-prompt.expected.md': formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)),
      'tool-schemas.expected.json': formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)),
    }
    for (const [name, text] of Object.entries(outputs)) {
      if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(join(scene, name), text)
      else expect(text).toBe(readFileSync(join(scene, name), 'utf8'))
    }
  } finally {
    const homeStat = lstatSync(home)
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink() || !basename(home).startsWith('dsh-todo-native-')
      || dirname(realpathSync(home)) !== realpathSync(tmpdir()) || realpathSync(home) !== resolve(home)) {
      throw new Error('todo-native: unsafe fixture cleanup root')
    }
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('todo-native: fixture junction was replaced')
    for (const link of links) unlinkSync(link)
    rmSync(home, { recursive: true, force: true })
  }
}, 40_000)
