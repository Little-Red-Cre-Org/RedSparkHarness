/** Recorded SDK mixed subagent turn replayed through the shipped dsh --profile sdk. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/subagent-mixed')
const fixture = join(scene, 'session.v3.jsonl')
const child = join(scene, 'session.1.v3.jsonl')
const forkChild = join(scene, 'session.2.v3.jsonl')
const sessionId = 'sdk-legacy-subagent-mixed'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK mixed: recorded ${kind} has no text`)
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

function resultText(event: { readonly data: Record<string, unknown> }): string {
  return JSON.stringify(event.data)
}

it('replays the recorded SDK mixed subagent turn through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (inputs.length !== 2 || inputs.some(event => event.type !== 'user/message')) {
    throw new Error('legacy SDK mixed: expected two user tasks')
  }
  const replies = recorded.filter(event => event.type === 'assistant/message'
    && event.data.message.content.some(block => block.type === 'text' && block.text.length > 0))
  const firstReply = replies[0]
  const lastReply = replies.at(-1)
  if (firstReply?.type !== 'assistant/message' || lastReply?.type !== 'assistant/message') {
    throw new Error('legacy SDK mixed: recorded replies missing')
  }
  const remember = textBlock(inputs[0].data.content, 'remember task')
  const delegate = textBlock(inputs[1].data.content, 'delegate task')
  const acknowledged = textBlock(firstReply.data.message.content, 'acknowledgement')
  const reply = textBlock(lastReply.data.message.content, 'reply')

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-mixed-')))
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
  const composition = shippedNativeProfileComposition(home, 'sdk')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-subagent-mixed',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: composition.installations.map(row => row.id === 'pi-ai' ? {
      id: 'pi-ai', plugin: 'native-sdk-llm-replay', scope: row.scope,
      config: {
        file: fixture,
        childFiles: [child, forkChild],
        providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }],
      },
    } : row),
  }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'You are a helpful coding assistant.', maxSteps: 4 } },
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
    const remembered = await session.run(remember)
    expect(remembered.finalResponse).toBe(acknowledged)
    const result = await session.run(delegate)
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const events = persistedEvents(sessions)
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['subagent', 'subagent_fork'])
    expect(events.filter(event => event.type === 'tool/result').map(resultText).join('\n')).toContain('ALPHA')
    expect(events.filter(event => event.type === 'tool/result').map(resultText).join('\n')).toContain('SAFFRON')
  } finally {
    await harness.close()
    rmSync(home, { recursive: true, force: true })
  }
}, 90_000)
