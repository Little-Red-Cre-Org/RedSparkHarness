/** Recorded SDK policy inheritance replayed through the shipped dsh --profile sdk. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/subagent-continuable-inheritance')
const fixture = join(scene, 'session.v3.jsonl')
const child = join(scene, 'session.1.v3.jsonl')
const sessionId = 'sdk-legacy-inheritance'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK inheritance: recorded ${kind} has no text`)
  return block.text
}

function persistedLogs(sessions: string): { id: string; events: { type: string; data: Record<string, unknown> }[] }[] {
  let names: string[]
  try {
    names = readdirSync(sessions, { recursive: true }).map(String).filter(name => name.endsWith('session.v3.jsonl'))
  } catch {
    return []
  }
  return names.map(name => {
    const lines = readFileSync(join(sessions, name), 'utf8').split('\n').filter(line => line.length > 0)
    const header = JSON.parse(lines[0] ?? '{}') as { id?: string }
    const events = lines.slice(1).map(line => JSON.parse(line) as { type: string; data: Record<string, unknown> })
    return { id: header.id ?? '', events }
  })
}

async function waitForInheritedPolicy(sessions: string): Promise<{ id: string; events: { type: string; data: Record<string, unknown> }[] }[]> {
  const started = Date.now()
  for (;;) {
    const logs = persistedLogs(sessions)
    const childLog = logs.find(log => log.events.some(event => event.type === 'subagent/descriptor'))
    const inherited = childLog?.events.some(event => event.type === 'sandbox/mode'
      && event.data.mode === 'read-only' && event.data.source === 'delegation')
    if (childLog !== undefined && inherited === true) return logs
    if (Date.now() - started > 20_000) {
      throw new Error(`legacy SDK inheritance: child policy missing ${JSON.stringify(logs.map(log => log.events.map(event => event.type)))}`)
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

it('replays a read-only root into a continuable child through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const start = inputs[0]
  if (inputs.length !== 1 || start?.type !== 'user/message') {
    throw new Error('legacy SDK inheritance: expected one user task')
  }
  const replies = recorded.filter(event => event.type === 'assistant/message'
    && event.data.message.content.some(block => block.type === 'text' && typeof block.text === 'string' && block.text.length > 0))
  const noted = replies[0]
  if (replies.length !== 1 || noted?.type !== 'assistant/message') {
    throw new Error('legacy SDK inheritance: recorded reply missing')
  }
  const startTask = textBlock(start.data.content, 'start task')
  const notedText = textBlock(noted.data.message.content, 'noted reply')

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-inheritance-')))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const profile = join(home, 'profiles', 'sdk')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  const replayEntry = pathToFileURL(join(root, 'rsh/Tests/test-support/llm-replay/lib/native.js')).href
  mkdirSync(join(profile, 'node_modules', 'native-sdk-llm-replay'), { recursive: true })
  writeFileSync(join(profile, 'node_modules', 'native-sdk-llm-replay', 'package.json'), JSON.stringify({
    name: 'native-sdk-llm-replay', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(profile, 'node_modules', 'native-sdk-llm-replay', 'native.mjs'), `export { plugin } from '${replayEntry}'\n`)
  mkdirSync(join(profile, 'node_modules', 'native-sdk-root-readonly'), { recursive: true })
  writeFileSync(join(profile, 'node_modules', 'native-sdk-root-readonly', 'package.json'), JSON.stringify({
    name: 'native-sdk-root-readonly', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['activeSessions'], optional: [], provides: [] } },
  }))
  writeFileSync(join(profile, 'node_modules', 'native-sdk-root-readonly', 'native.mjs'), [
    'export const plugin = {',
    "  apiVersion: 1, name: 'native-sdk-root-readonly', targets: ['host'],",
    "  requires: ['activeSessions'], provides: [],",
    '  resolve: () => context => {',
    "    const sessions = context.require('activeSessions')",
    '    context.effect(sessions.onAttached(async (owner) => {',
    "      if (owner.invocation !== 'root' || owner.session.header.parentSession !== undefined) return",
    '      const prior = await owner.readEvents()',
    "      if (prior.some(event => event.type === 'sandbox/mode')) return",
    "      owner.append('sandbox/mode', { mode: 'read-only' })",
    '      await owner.flush()',
    '    }))',
    '  },',
    '}',
    '',
  ].join('\n'))
  const composition = shippedNativeProfileComposition(home, 'sdk')
  const scope = composition.installations.find(row => row.id === 'sandbox-policy')?.scope
  if (scope === undefined) throw new Error('legacy SDK inheritance: sandbox policy row missing')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-inheritance',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: [
      ...composition.installations.map(row => {
        if (row.id === 'pi-ai') return {
          id: 'pi-ai', plugin: 'native-sdk-llm-replay', scope: row.scope,
          config: {
            file: fixture,
            childFiles: [child],
            providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }],
          },
        }
        if (row.id !== 'subagent-tool') return row
        const config = row.config
        if (config === null || typeof config !== 'object' || Array.isArray(config)) {
          throw new Error('legacy SDK inheritance: subagent tool config missing')
        }
        return { ...row, config: { ...config, backgroundMode: 'continuable' } }
      }),
      // The recorded sdk bundle composes approval. Shipped native-sdk does not.
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'ask' } },
      { id: 'root-readonly', plugin: 'native-sdk-root-readonly', scope },
    ],
  }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'You are a helpful coding assistant.', maxSteps: 8 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'fs', config: { cwd: workspace } },
  ] }))
  const harness = new RedSparkHarness({
    rshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'),
    rshHome: home,
    patches: [patch],
    cwd: workspace,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    env: { ...process.env, RSH_TELEMETRY_DISABLED: '1' },
    requestTimeoutMs: 40_000,
  })
  try {
    const session = harness.session(sessionId)
    const started = await session.run(startTask)
    expect(started.finalResponse).toBe(notedText)
    const logs = await waitForInheritedPolicy(sessions)
    const parent = logs.find(log => log.id === sessionId)
    const childLog = logs.find(log => log.events.some(event => event.type === 'subagent/descriptor'))
    if (parent === undefined || childLog === undefined) throw new Error('legacy SDK inheritance: sessions missing')
    expect(parent.events).toContainEqual(expect.objectContaining({ type: 'sandbox/mode', data: { mode: 'read-only' } }))
    expect(childLog.events).toContainEqual(expect.objectContaining({
      type: 'sandbox/mode', data: { mode: 'read-only', source: 'delegation' },
    }))
    expect(childLog.events).toContainEqual(expect.objectContaining({
      type: 'approval/policy', data: { policy: 'never', source: 'delegation' },
    }))
    const childText = JSON.stringify(childLog.events)
    expect(childText).toContain('Current DSH file policy: read-only.')
    expect(childText).toContain('Approval prompts are disabled in this session')
    expect(childText).toContain('CHILD_OK')
  } finally {
    await harness.close()
  }
}, 90_000)
