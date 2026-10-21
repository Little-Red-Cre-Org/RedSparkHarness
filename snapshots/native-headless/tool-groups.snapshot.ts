/** Shipped Native CLI composition records and replays request-bound tool-group grants. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { normalizeSessionSnapshot, redactSessionSnapshotIds, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot } from '@deepseek-ai/dsh-session-snapshot'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/tool-groups')

it.each(['native'] as const)('replays group expansion through the shipped %s CLI profile', async () => {
  const fixture = join(scene, 'session.v3.jsonl')
  const recorded = existsSync(fixture) ? parseSessionLog(readFileSync(fixture, 'utf8')) : undefined
  const script = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const initial = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = initial?.type === 'user/message' && initial.data.content[0]?.type === 'text'
    ? initial.data.content[0].text : 'Open the planning tools and finish the plan.'
  const home = mkdtempSync(join(tmpdir(), 'rsh-groups-snapshot-'))
  const profile = join(home, 'profiles/native-headless')
  const modules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const audit = join(home, 'audit.jsonl')
  mkdirSync(modules, { recursive: true }); mkdirSync(workspace)
  const packages = [
    ['native-headless', 'rsh/Engine/core/native-headless/src/native.ts'],
    ['native-agent', 'rsh/Engine/core/native-agent/src/index.ts'],
    ['native-session-execution', 'rsh/Engine/core/native-session-execution/src/index.ts'],
    ['native-tools', 'rsh/Engine/core/native-tools/src/native.ts'],
    ['native-model-execution', 'rsh/Engine/core/native-model-execution/src/native.ts'],
    ['session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl/src/native.ts'],
    ['fs-local', 'rsh/Modules/Official/fs/fs-local/src/native.ts'],
    ['fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy/src/native.ts'],
    ['tool-todo', 'rsh/Modules/Official/todo/tool-todo/src/native.ts'],
    ['tool-groups', 'rsh/Modules/Official/guard/tool-groups/src/native.ts'],
  ] as const
  for (const [name, source] of packages) {
    const directory = join(modules, `group-fixture-${name}`)
    mkdirSync(directory, { recursive: true })
    const manifest = JSON.parse(readFileSync(join(root, dirname(source), '../package.json'), 'utf8'))
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ ...manifest, name: `group-fixture-${name}`,
      exports: { './native': './native.mjs', './package.json': './package.json' } }))
    writeFileSync(join(directory, 'native.mjs'), `export { ${name === 'fs-local' ? 'localFilesystemPlugin as plugin' : 'plugin'} } from ${JSON.stringify(pathToFileURL(join(root, source)).href)};`)
  }
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'native-headless-profile', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
  const composition = shippedNativeProfileComposition(home, 'native-headless')
  const selected = new Set(['app', 'agents', 'session-execution', 'tools', 'model-execution', 'storage', 'fs', 'policy', 'tool-todo', 'pi-ai'])
  const installations = composition.installations.map(row => {
    if (!selected.has(row.id)) return { ...row, disabled: true }
    if (row.id === 'storage') return { ...row, config: { root: sessions, compression: 'none' } }
    if (row.id === 'app') return { ...row, config: { cwd: workspace, provider: 'mock', model: 'groups',
      systemPrompt: 'Use tools as needed.', builtinTools: false, maxSteps: 3 } }
    if (row.id === 'tools') return { ...row, config: { mode: 'native' } }
    if (row.id === 'fs') return { ...row, plugin: '@deepseek-ai/dsh-fs-local', config: { cwd: workspace } }
    if (row.id === 'pi-ai') return { id: row.id, scope: row.scope, plugin: 'group-model' }
    return row
  })
  installations.push({ id: 'tool-groups', scope: 'root', plugin: '@deepseek-ai/dsh-tool-groups',
    config: { initial: [], groups: [{ name: 'planning', description: 'Maintain the task plan', tools: ['todo_write'] }] } })
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition,
    installations: installations.map(row => selected.has(row.id) || row.id === 'tool-groups'
      ? { ...row, plugin: row.plugin.replace('@deepseek-ai/dsh-', 'group-fixture-') } : row) }))
  const model = join(modules, 'group-model'); mkdirSync(model)
  writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'group-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } } }))
  writeFileSync(join(model, 'native.mjs'), `import { appendFileSync } from 'node:fs';
export const plugin = { apiVersion: 1, name: 'group-model', targets: ['host'], requires: [], provides: ['model'],
 resolve: () => context => { let step = 0; context.provide('model', { async *stream(request) {
 appendFileSync(${JSON.stringify(audit)}, JSON.stringify(request.tools) + '\\n');
 if (${JSON.stringify(script)} !== undefined) {
   const entry = ${JSON.stringify(script)}[step++];
   if (entry?.kind !== 'chunks') throw new Error('group replay exhausted');
   for (const chunk of entry.chunks) yield chunk;
 } else if (++step <= 2) {
   yield { type: 'block-start', index: 0, blockType: 'tool-call' };
   yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'group-' + step,
     name: step === 1 ? 'request_tool_group' : 'todo_write', arguments: JSON.stringify(step === 1 ? { group: 'planning' }
       : { todos: [{ content: 'Finish the plan', status: 'completed' }] }) } };
   yield { type: 'finish', reason: { kind: 'tool-calls' } };
 } else {
   yield { type: 'block-start', index: 0, blockType: 'text' };
   yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Plan complete.' } };
   yield { type: 'finish', reason: { kind: 'stop' } };
 }
 } }) } }`)
  try {
    const child = await execa(process.execPath, ['--import', 'tsx/esm', join(root, 'rsh/Programs/CLI/src/bin.ts'),
      '--profile', 'native-headless', task], { cwd: root,
      env: { ...process.env, DSH_HOME: home, TSX_TSCONFIG_PATH: join(root, 'tsconfig.base.json') }, reject: false, timeout: 60_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    const requests = readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { name: string }[])
    expect(requests.map(tools => tools.map(tool => tool.name))).toEqual([
      ['request_tool_group'], ['todo_write', 'request_tool_group'], ['todo_write', 'request_tool_group'],
    ])
    const file = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))!
    const raw = readFileSync(join(sessions, String(file)), 'utf8')
    const context = { sessionIds: [], cwd: workspace }
    const prompts = normalizedSystemPrompts(raw, context); const schemas = normalizedToolSchemas(raw, context)
    const outputs = {
      'session.v3.jsonl': normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' }),
      'system-prompt.expected.md': formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)),
      'tool-schemas.expected.json': formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)),
    }
    for (const [name, content] of Object.entries(outputs)) {
      if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(join(scene, name), content)
      else expect(content).toBe(readFileSync(join(scene, name), 'utf8'))
    }
  } finally {
    if (dirname(realpathSync(home)) !== realpathSync(tmpdir())) throw new Error('unsafe snapshot cleanup root')
    rmSync(home, { recursive: true, force: true })
  }
}, 90_000)
