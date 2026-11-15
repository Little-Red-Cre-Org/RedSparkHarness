/** Recorded SDK continuable listing replayed through the shipped dsh --profile sdk. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/subagent-list-agents')
const fixture = join(scene, 'session.v3.jsonl')
const child = join(scene, 'session.1.v3.jsonl')
const sessionId = 'sdk-legacy-list-agents'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK list-agents: recorded ${kind} has no text`)
  return block.text
}

function persistedEvents(sessions: string): { type: string; data: Record<string, unknown> }[] {
  let names: string[]
  try {
    names = readdirSync(sessions, { recursive: true }).map(String).filter(name => name.endsWith('session.v3.jsonl'))
  } catch {
    return []
  }
  return names.flatMap(name => readFileSync(join(sessions, name), 'utf8').split('\n').filter(line => line.length > 0)
    .map(line => JSON.parse(line) as { type: string; data: Record<string, unknown> }))
}

async function waitForAssistant(tree: ReturnType<RedSparkHarness['client']['subscribeSessionTree']>, text: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`legacy SDK list-agents: missing assistant text ${text}`)), 25_000)
  })
  const listen = (async () => {
    for (;;) {
      const notification = await tree.next()
      if (notification.method !== 'session.event' || notification.params.sessionId !== sessionId) continue
      const event = notification.params.event as { type?: string; data?: { message?: { content?: readonly { type?: string; text?: string }[] } } }
      if (event.type !== 'assistant/message') continue
      if (event.data?.message?.content?.some(block => block.type === 'text' && block.text === text)) return
    }
  })()
  try { await Promise.race([listen, timeout]) }
  finally { if (timer !== undefined) clearTimeout(timer) }
}

it('replays the recorded SDK continuable listing through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const start = inputs[0]
  const followUp = inputs[1]
  if (inputs.length !== 2 || start?.type !== 'user/message' || followUp?.type !== 'user/message') {
    throw new Error('legacy SDK list-agents: expected two user tasks')
  }
  const replies = recorded.filter(event => event.type === 'assistant/message'
    && event.data.message.content.some(block => block.type === 'text'))
  const startedReply = replies[0]
  const settledReply = replies[1]
  const doneReply = replies[2]
  if (startedReply?.type !== 'assistant/message' || settledReply?.type !== 'assistant/message'
    || doneReply?.type !== 'assistant/message') {
    throw new Error('legacy SDK list-agents: recorded replies missing')
  }
  const startTask = textBlock(start.data.content, 'start task')
  const followUpTask = textBlock(followUp.data.content, 'list task')
  const startedText = textBlock(startedReply.data.message.content, 'start reply')
  const settledText = textBlock(settledReply.data.message.content, 'settlement reply')
  const doneText = textBlock(doneReply.data.message.content, 'done reply')

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-list-')))
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
    name: 'legacy-sdk-list-agents',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: composition.installations.map(row => {
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
        throw new Error('legacy SDK list-agents: subagent tool config missing')
      }
      return { ...row, config: { ...config, backgroundMode: 'continuable' } }
    }),
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
  const tree = harness.client.subscribeSessionTree(sessionId)
  try {
    const session = harness.session(sessionId)
    const started = await session.run(startTask)
    expect(started.finalResponse).toBe(startedText)
    await waitForAssistant(tree, settledText)
    const listed = await session.run(followUpTask)
    expect(listed.finalResponse).toBe(doneText)
    const events = persistedEvents(sessions)
    const serialized = JSON.stringify(events)
    expect(serialized).toContain('subagent-settled')
    expect(serialized).toContain('CHILD_OK')
    const listResult = events.find(event => event.type === 'tool/result' && JSON.stringify(event.data).includes('call_list'))
    const message = listResult?.data.message as { content?: { content?: { text?: string }[] }[] } | undefined
    const rendered = message?.content?.[0]?.content?.[0]?.text
    if (rendered === undefined) throw new Error('legacy SDK list-agents: list result has no text')
    expect(JSON.parse(rendered)).toEqual([expect.objectContaining({ kind: 'child', label: 'Reply with CHILD_OK', status: 'ready' })])
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['subagent', 'list_agents'])
  } finally {
    tree.close()
    await harness.close()
    rmSync(home, { recursive: true, force: true })
  }
}, 90_000)
