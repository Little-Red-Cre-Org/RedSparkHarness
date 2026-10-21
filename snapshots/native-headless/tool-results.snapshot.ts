/** Actual dsh tool pipeline, durable result ordering and cold replay. */
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless/tool-results')
const fixturePath = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))
const profile = join(root, 'rsh/Programs/CLI/tests/profiles/native-headless')

it('records mode-selected tool results, extra model input and whole-batch conclusion through dsh', async () => {
  const recorded = parseSessionLog(readFileSync(fixturePath, 'utf8'))
  const initial = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (initial?.type !== 'user/message' || initial.data.content[0]?.type !== 'text') throw new Error('tool-results: no recorded user task')
  const task = initial.data.content[0].text
  const script = deriveReplayScript(recorded)
  const home = mkdtempSync(join(tmpdir(), 'dsh-tool-results-'))
  const profileDir = join(home, 'profiles/native-headless')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const audit = join(home, 'audit.jsonl')
  const patch = join(home, 'tool-results.patch.json')
  const modules = join(profileDir, 'node_modules')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  copyFileSync(join(profile, 'package.json'), join(profileDir, 'package.json'))
  copyFileSync(join(profile, 'rsh.profile.json'), join(profileDir, 'rsh.profile.json'))
  for (const [name, path] of [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'],
    ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
    ['dsh-native-tools', 'rsh/Engine/core/native-tools'],
    ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'],
    ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['dsh-llm', 'rsh/Engine/llm/llm'],
  ] as const) symlinkSync(join(root, path), join(modules, '@deepseek-ai', name), 'junction')
  const modelDir = join(modules, 'native-fixture-model')
  mkdirSync(modelDir)
  writeFileSync(join(modelDir, 'package.json'), JSON.stringify({
    name: 'native-fixture-model', type: 'module', dependencies: { '@deepseek-ai/dsh-llm': '*' },
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['tools'], optional: [], provides: ['model'] } },
  }))
  copyFileSync(join(root, 'rsh/Engine/core/native-headless/tests/fixtures/tool-results-model.mjs'), join(modelDir, 'native.mjs'))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Use the registered tool pipeline.', maxSteps: 3 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'fs', config: { cwd: workspace } },
    { id: 'model', config: { script, audit, sessionsRoot: sessions } },
    { id: 'tools', config: { mode: 'native' } },
    ...['time-context', 'code-runtime', 'jobs', 'tool-jobs'].map(id => ({ id, disabled: true })),
  ] }))
  try {
    const child = await execa(process.execPath, [
      '--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', '--patch', patch, task,
    ], { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    const auditRows = readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    const requests = auditRows.filter(row => row.kind === 'model')
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1]?.messages)).toContain('durable extra input')
    expect(auditRows.filter(row => row.kind === 'accepted').map(row => row.name)).toEqual(['context', 'finish', 'after'])
    const storage = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    let raw: string
    let persisted: Readonly<typeof recorded>
    let physicalPath: string
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('tool-results: process did not persist a Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        persisted = events
        expect(events.filter(event => event.type === 'tool/result')).toHaveLength(3)
        expect(events.find(event => event.type === 'tool/result')).toMatchObject({ data: { meta: { display: 'context' } } })
        const extra = events.findIndex(event => event.type === 'user/message' && event.data.source.kind === 'plugin'
          && event.data.source.plugin === 'tool-results-fixture')
        const firstResult = events.findIndex(event => event.type === 'tool/result')
        const nextAssistant = events.findIndex(event => event.type === 'assistant/message' && event.data.step === 2)
        expect(extra).toBeGreaterThan(firstResult)
        expect(extra).toBeLessThan(nextAssistant)
        expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      } finally { await reader.close() }
      const name = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
      if (name === undefined) throw new Error('tool-results: missing physical Session')
      physicalPath = join(sessions, String(name))
      raw = readFileSync(physicalPath, 'utf8')
    } finally { await storage.close() }
    const cold = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const id = (await cold.list())[0]?.header.id
      if (id === undefined) throw new Error('tool-results: cold Session disappeared')
      const reader = await cold.open(id, 'read')
      try { expect((await reader.read()).events).toEqual(persisted) }
      finally { await reader.close() }
    } finally { await cold.close() }
    expect(readFileSync(physicalPath, 'utf8')).toBe(raw)
    const context = { sessionIds: [], cwd: workspace }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, context, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, context)
    const schemas = normalizedToolSchemas(raw, context)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('tool-results: missing request header')
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
