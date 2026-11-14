/** Recorded SDK DSH SDK diagnostic turn replayed through the shipped dsh --profile sdk. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/subagent-rsh-sdk-diagnostic')
const fixture = join(scene, 'session.v3.jsonl')
const sessionId = 'sdk-legacy-dsh-sdk-diagnostic'
const diagnostic = 'Subagent failure (provider: DSH SDK; stage: session-run; category: child-error)'
const partial = 'partial child loader answer'
const disabledRows = new Set(['workflow-worker', 'workflow-tool', 'ralph-tool', 'subagent-tool-fork'])

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK dsh-sdk diagnostic: recorded ${kind} has no text`)
  return block.text
}

function persistedEvents(sessions: string): { type: string; data: Record<string, unknown> }[] {
  let names: string[]
  try {
    names = readdirSync(sessions, { recursive: true }).map(String).filter(name => name.endsWith('session.v3.jsonl'))
  } catch {
    // The server can exit before creating the session directory.
    return []
  }
  return names.flatMap(name => readFileSync(join(sessions, name), 'utf8').split('\n').filter(line => line.length > 0)
    .map(line => JSON.parse(line) as { type: string; data: Record<string, unknown> }))
}

const driverSource = `const results = [
  { remoteId: 'snapshot-dsh-sdk-fg', diagnostic: ${JSON.stringify(diagnostic)}, output: ${JSON.stringify(partial)} },
  { remoteId: 'snapshot-dsh-sdk-bg', diagnostic: ${JSON.stringify(diagnostic)}, output: '' },
]
let starts = 0
export const plugin = {
  apiVersion: 1,
  name: 'snapshot-dsh-sdk-driver',
  targets: ['host'],
  requires: [],
  provides: ['externalSubagentDriver'],
  resolve: () => (context) => {
    context.provide('externalSubagentDriver', {
      name: 'snapshot-dsh-sdk',
      routeFields: [],
      capabilities: { persona: false, toolFilter: false, outputSchema: false },
      async start() {
        const item = results[starts++]
        if (item === undefined) throw new Error('snapshot dsh-sdk driver expected exactly two starts')
        return {
          remoteId: item.remoteId,
          result: Promise.resolve({
            output: item.output.length === 0 ? [] : [{ type: 'text', text: item.output }],
            diagnostic: item.diagnostic,
            stopReason: 'error',
          }),
          async dispose() {},
        }
      },
    })
  },
}
`

it('replays the recorded DSH SDK diagnostic through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const input = inputs[0]
  if (inputs.length !== 1 || input?.type !== 'user/message') throw new Error('legacy SDK dsh-sdk diagnostic: expected one user task')
  const answer = recorded.find(event => event.type === 'assistant/message'
    && event.data.message.content.some(block => block.type === 'text'))
  if (answer?.type !== 'assistant/message') throw new Error('legacy SDK dsh-sdk diagnostic: recorded reply missing')
  const task = textBlock(input.data.content, 'task')
  const reply = textBlock(answer.data.message.content, 'reply')

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-dsh-sdk-')))
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
  mkdirSync(join(profile, 'node_modules', 'snapshot-dsh-sdk-driver'), { recursive: true })
  writeFileSync(join(profile, 'node_modules', 'snapshot-dsh-sdk-driver', 'package.json'), JSON.stringify({
    name: 'snapshot-dsh-sdk-driver', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['externalSubagentDriver'] } },
  }))
  writeFileSync(join(profile, 'node_modules', 'snapshot-dsh-sdk-driver', 'native.mjs'), driverSource)
  const composition = shippedNativeProfileComposition(home, 'sdk')
  const scope = composition.installations[0]?.scope
  if (scope === undefined) throw new Error('legacy SDK dsh-sdk diagnostic: shipped sdk composition is empty')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-dsh-sdk-diagnostic',
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
            providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }],
          },
        }
        if (row.id === 'subagents') return { ...row, config: { providerName: 'snapshot-dsh-sdk' } }
        if (disabledRows.has(row.id)) return { ...row, disabled: true }
        return row
      }),
      { id: 'dsh-sdk-driver', plugin: 'snapshot-dsh-sdk-driver', scope },
      { id: 'dsh-sdk-tool', plugin: '@redspark/rsh-tool-subagent', scope, config: {
        toolName: 'subagent_dsh_sdk', maxDepth: 1, backgroundMode: 'one-shot',
      } },
      { id: 'dsh-sdk-tool-bg', plugin: '@redspark/rsh-tool-subagent', scope, config: {
        toolName: 'subagent_dsh_sdk_background', maxDepth: 1, backgroundMode: 'one-shot',
      } },
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
    const result = await harness.session(sessionId).run(task)
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const calls = result.events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : '')
    expect(calls).toEqual(['subagent_dsh_sdk', 'subagent_dsh_sdk_background', 'job_output'])
    const text = JSON.stringify(persistedEvents(sessions))
    expect(text).toContain(diagnostic)
    expect(text).toContain(partial)
    expect(text).toContain(reply)
  } finally {
    await harness.close()
    rmSync(home, { recursive: true, force: true })
  }
}, 60_000)
