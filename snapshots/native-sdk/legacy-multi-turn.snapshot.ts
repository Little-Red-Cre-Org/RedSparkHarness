/** Recorded SDK multi-turn replayed through the shipped dsh --profile sdk. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/multi-turn')
// Retained v2 is the replay input. The directory has no current-generation Session file.
const fixture = join(scene, 'session.v2.jsonl')
const sessionId = 'sdk-legacy-multi-turn'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK multi-turn: recorded ${kind} has no text`)
  return block.text
}

it('replays the recorded SDK multi-turn session through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (inputs.length !== 2 || inputs.some(event => event.type !== 'user/message')) {
    throw new Error('legacy SDK multi-turn: expected two user tasks')
  }
  const replies = recorded.filter(event => event.type === 'assistant/message'
    && event.data.message.content.some(block => block.type === 'text' && block.text.length > 0))
  const firstReply = replies[0]
  const secondReply = replies[1]
  if (replies.length !== 2 || firstReply?.type !== 'assistant/message' || secondReply?.type !== 'assistant/message') {
    throw new Error('legacy SDK multi-turn: recorded replies missing')
  }
  const first = textBlock(inputs[0].data.content, 'first task')
  const second = textBlock(inputs[1].data.content, 'second task')
  const firstText = textBlock(firstReply.data.message.content, 'first reply')
  const secondText = textBlock(secondReply.data.message.content, 'second reply')

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-multi-')))
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
    name: 'legacy-sdk-multi-turn',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: composition.installations.map(row => row.id === 'pi-ai' ? {
      id: 'pi-ai', plugin: 'native-sdk-llm-replay', scope: row.scope,
      config: { file: fixture, providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }] },
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
    const one = await session.run(first)
    expect(one.finalResponse).toBe(firstText)
    expect(one.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const two = await session.run(second)
    expect(two.finalResponse).toBe(secondText)
    expect(two.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(one.events.filter(event => event.type === 'tool/call')).toEqual([])
    expect(two.events.filter(event => event.type === 'tool/call')).toEqual([])
  } finally {
    await harness.close()
    rmSync(home, { recursive: true, force: true })
  }
}, 90_000)
