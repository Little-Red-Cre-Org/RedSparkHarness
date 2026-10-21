/** Shipped profile, authenticated browser peer, persisted source text and cold replay. */
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { JsonlSessionBackend } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scenario = join(root, 'snapshots/native-headless/browser-read-only')
const browserPackage = join(root, 'rsh/Modules/Official/web/browser-read-only')
const fixturePath = join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION))

it.each(['authorized source'] as const)('persists and replays %s through the shipped native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixturePath, 'utf8'))
  const initial = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (initial?.type !== 'user/message' || initial.data.content[0]?.type !== 'text') throw new Error('browser snapshot lacks a task')
  const home = mkdtempSync(join(tmpdir(), 'native-browser-'))
  const profileDir = join(home, 'profiles/native-headless')
  const modules = join(profileDir, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const connectionFile = join(home, 'browser.json')
  const audit = join(home, 'requests.jsonl')
  mkdirSync(workspace); mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
  const profileSource = join(root, 'rsh/Programs/CLI/tests/profiles/native-headless')
  copyFileSync(join(profileSource, 'package.json'), join(profileDir, 'package.json'))
  const composition = JSON.parse(readFileSync(join(profileSource, 'rsh.profile.json'), 'utf8')) as {
    installations: Array<{ id: string; plugin: string; scope: string; config?: unknown; disabled?: boolean }>
  }
  composition.installations.push({ id: 'browser', plugin: '@deepseek-ai/dsh-browser-read-only', scope: 'root', config: { connectionFile } })
  composition.installations.push({ id: 'approval', plugin: '@deepseek-ai/dsh-native-approval', scope: 'root' })
  const configs: Record<string, unknown> = {
    app: { cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Read only the explicitly authorized browser page.', maxSteps: 4 },
    fs: { cwd: workspace }, storage: { root: sessions, compression: 'none' }, tools: { mode: 'native' },
    model: { script: deriveReplayScript(recorded), connectionFile, audit },
  }
  for (const row of composition.installations) {
    if (Object.hasOwn(configs, row.id)) row.config = configs[row.id]
    if (['time-context', 'code-runtime', 'jobs', 'tool-jobs'].includes(row.id)) row.disabled = true
  }
  writeFileSync(join(profileDir, 'rsh.profile.json'), JSON.stringify(composition))
  for (const [name, directory] of [
    ['dsh-native-headless', 'rsh/Engine/core/native-headless'], ['dsh-native-agent', 'rsh/Engine/core/native-agent'],
    ['dsh-native-tools', 'rsh/Engine/core/native-tools'], ['dsh-native-model-execution', 'rsh/Engine/core/native-model-execution'],
    ['dsh-session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
    ['dsh-fs-local', 'rsh/Modules/Official/fs/fs-local'], ['dsh-fs-observation-policy', 'rsh/Modules/Official/fs/fs-observation-policy'],
    ['dsh-browser-read-only', 'rsh/Modules/Official/web/browser-read-only'],
    ['dsh-native-approval', 'rsh/Modules/Official/interaction/native-approval'],
  ] as const) symlinkSync(join(root, directory), join(modules, '@deepseek-ai', name), 'junction')
  const modelDir = join(modules, 'native-fixture-model')
  mkdirSync(modelDir)
  writeFileSync(join(modelDir, 'package.json'), JSON.stringify({ name: 'native-fixture-model', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['browserReadOnly', 'approval'], optional: [], provides: ['model'] } },
  }))
  copyFileSync(join(browserPackage, 'tests/fixtures/replay-model.mjs'), join(modelDir, 'native.mjs'))
  try {
    const child = await execa(process.execPath, [
      '--import', pathToFileURL(join(root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', initial.data.content[0].text,
    ], { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 30000 })
    expect(child.exitCode, child.stderr).toBe(0)
    expect(existsSync(connectionFile)).toBe(false)
    const requests = readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { messages: unknown })
    expect(requests).toHaveLength(4)
    expect(JSON.stringify(requests[2]?.messages)).toContain('Visible source text.')
    expect(JSON.stringify(requests[3]?.messages)).toContain('Page is not authorized')
    const name = readdirSync(sessions, { recursive: true }).find(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
    if (name === undefined) throw new Error('browser snapshot lacks a persisted Session')
    const raw = readFileSync(join(sessions, String(name)), 'utf8')
    expect(raw).toContain('https://source.example/article')
    expect(raw).not.toContain('"token"')
    const cold = new JsonlSessionBackend({ root: sessions, compression: 'none' })
    try {
      const sessionId = (await cold.list())[0]?.header.id
      if (sessionId === undefined) throw new Error('browser Session cannot be reopened')
      const reader = await cold.open(sessionId, 'read')
      try {
        const results = (await reader.read()).events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(3)
        expect(results.at(-1)?.data.message.content[0]).toMatchObject({ type: 'tool-result', isError: true })
      }
      finally { await reader.close() }
    } finally { await cold.close() }
    const normalization = { sessionIds: [], cwd: workspace }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, normalization, { identityMode: 'preserve' })
    const prompts = normalizedSystemPrompts(raw, normalization)
    const schemas = normalizedToolSchemas(raw, normalization)
    if (prompts[0] === undefined || schemas[0] === undefined) throw new Error('browser snapshot lacks headers')
    for (const [path, value] of [
      [fixturePath, normalized],
      [join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0], prompts.slice(1))],
      [join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0], schemas.slice(1))],
    ] as const) {
      if (process.env.DSH_SNAPSHOT === 'refresh') writeFileSync(path, value)
      else expect(value).toBe(readFileSync(path, 'utf8'))
    }
  } finally { rmSync(home, { recursive: true, force: true }) }
})
