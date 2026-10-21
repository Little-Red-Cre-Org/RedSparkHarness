/** Public confined PTC execution, real job cancellation, and durable cold reading. */
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
  normalizeSessionSnapshot, redactSessionSnapshotIds } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/ptc-jobs')

it('runs confined PTC through dsh, cancels a real job and cold-reads the sole durable log', async () => {
  const expected = join(scene, 'session.v3.jsonl')
  const recorded = existsSync(expected) ? parseSessionLog(readFileSync(expected, 'utf8')) : undefined
  const input = recorded?.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const task = input?.type === 'user/message' && input.data.content[0]?.type === 'text'
    ? input.data.content[0].text : 'Inspect and cancel the background job.'
  const script = recorded === undefined ? undefined : deriveReplayScript(recorded)
  const home = mkdtempSync(join(tmpdir(), 'dsh-ptc-jobs-'))
  const profile = join(home, 'profiles/native-ptc')
  const model = join(profile, 'node_modules/native-ptc-model')
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const audit = join(home, 'audit.txt')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(model, { recursive: true })
  for (const name of ['package.json', 'rsh.profile.json']) {
    copyFileSync(join(root, 'rsh/Programs/CLI/tests/profiles/native-ptc', name), join(profile, name))
  }
  writeFileSync(join(model, 'package.json'), JSON.stringify({
    name: 'native-ptc-model', type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['agents', 'jobs'], optional: [], provides: ['model'] } },
  }))
  copyFileSync(join(root, 'rsh/Engine/core/native-headless/tests/fixtures/ptc-jobs-model.mjs'), join(model, 'native.mjs'))
  const patch = join(home, 'patch.json')
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { cwd: workspace, provider: 'mock', model: 'fixture',
      systemPrompt: 'Use run_code to inspect and cancel the background job.', maxSteps: 3, builtinTools: false } },
    { id: 'fs', config: { cwd: workspace } },
    { id: 'shell', config: { graceMs: 500, bashPath: process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash' } },
    { id: 'sandbox-policy', config: { mode: 'read-only', workspaceRoot: workspace } },
    { id: 'storage', config: { root: sessions, compression: 'none' } }, { id: 'model', config: { audit, ...script === undefined ? {} : { script } } },
  ] }))
  try {
    const processResult = await execa(process.execPath, [
      '--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-ptc', '--patch', patch, task,
    ], { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30_000 })
    expect(processResult.exitCode, processResult.stderr).toBe(0)
    expect(readFileSync(audit, 'utf8')).toBe('cancelled\n')
    const name = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith('session.v3.jsonl'))
    if (name === undefined) throw new Error('ptc-jobs: missing durable Session')
    const physical = join(sessions, String(name))
    const raw = readFileSync(physical, 'utf8')
    const events = parseSessionLog(raw)
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ data: { message: { content: [{ type: 'tool-result', isError: true }] } } })
    expect(JSON.stringify(results[0])).toContain('timeout')
    expect(JSON.stringify(results[1])).toContain('cancelled')
    expect(JSON.stringify(results[1])).toContain('background task running')
    expect(events.filter(event => event.type === 'tool/ptc-dispatch').length).toBeGreaterThanOrEqual(5)
    const cold = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await cold.list())[0]?.header.id
      if (id === undefined) throw new Error('ptc-jobs: missing cold Session')
      const reader = await cold.open(id, 'read')
      try { expect((await reader.read()).events).toEqual(events) }
      finally { await reader.close() }
    } finally { await cold.close() }
    expect(readFileSync(physical, 'utf8')).toBe(raw)
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw,
      { cwd: workspace, sessionIds: [] }, { identityMode: 'preserve' })
    const context = { cwd: workspace, sessionIds: [] }
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('ptc-jobs: missing request header')
    const prompt = formatSystemPromptSnapshot(prompts[0], prompts.slice(1))
    const tools = formatToolSchemasSnapshot(schemas[0], schemas.slice(1))
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      writeFileSync(expected, normalized)
      writeFileSync(join(scene, 'system-prompt.expected.md'), prompt)
      writeFileSync(join(scene, 'tool-schemas.expected.json'), tools)
    } else {
      expect(normalized).toBe(readFileSync(expected, 'utf8'))
      expect(prompt).toBe(readFileSync(join(scene, 'system-prompt.expected.md'), 'utf8'))
      expect(tools).toBe(readFileSync(join(scene, 'tool-schemas.expected.json'), 'utf8'))
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
}, 45_000)
