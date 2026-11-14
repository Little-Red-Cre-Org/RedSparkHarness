/** Recorded SDK title turn replayed through dsh --profile sdk plus the title plugins. */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixture = join(root, 'snapshots/sdk/session-title-after-turn/session.v3.jsonl')
const sessionId = 'sdk-legacy-session-title'
const TITLE_SYSTEM = 'Create a concise title for an AI coding-assistant session'
const LATE_TITLE = 'Late durable session title'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK session title: recorded ${kind} has no text`)
  return block.text
}

function respond(response: ServerResponse, content: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    JSON.stringify({ choices: [{ delta: { role: 'assistant', content } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    '[DONE]',
  ].map(chunk => `data: ${chunk}\n\n`).join(''))
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

it('replays the recorded SDK title turn through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const input = inputs[0]
  if (inputs.length !== 1 || input?.type !== 'user/message') throw new Error('legacy SDK session title: expected one user task')
  const answer = recorded.find(event => event.type === 'assistant/message')
  if (answer?.type !== 'assistant/message') throw new Error('legacy SDK session title: recorded reply missing')
  const fallback = recorded.find(event => event.type === 'session/title' && event.data.source.kind === 'fallback')
  if (fallback?.type !== 'session/title') throw new Error('legacy SDK session title: recorded fallback missing')
  const task = textBlock(input.data.content, 'task')
  const reply = textBlock(answer.data.message.content, 'reply')

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-title-')))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const profile = join(home, 'profiles', 'sdk')
  const patch = join(home, 'model.patch.json')
  const requests: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push(body)
      if (body.includes(TITLE_SYSTEM)) {
        respond(response, LATE_TITLE)
        return
      }
      if (!body.includes(task)) {
        response.writeHead(500)
        response.end('legacy SDK session title: model request matched neither the title prompt nor the recorded task')
        return
      }
      respond(response, reply)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('legacy SDK session title: missing model endpoint')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  const composition = shippedNativeProfileComposition(home, 'sdk')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-session-title',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: [
      ...composition.installations,
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      { id: 'session-title-llm', plugin: '@redspark/rsh-session-title-first-prompt-llm', scope: 'root',
        config: { targetWords: 5, targetCjkCharacters: 10, maxInputBytes: 4096, maxOutputTokens: 32, timeoutMs: 5000,
          provider: 'fixture', model: 'fixture-model' } },
    ],
  }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'Reply to the recorded SDK task.', maxSteps: 2 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'fs', config: { cwd: workspace } },
    { id: 'pi-ai', config: { providers: { fixture: {
      apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY',
      api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      models: [{ id: 'fixture-model', input: ['text'] }],
    } } } },
  ] }))
  const harness = new RedSparkHarness({
    rshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'),
    rshHome: home,
    patches: [patch],
    cwd: workspace,
    provider: 'fixture',
    model: 'fixture-model',
    env: { ...process.env, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', RSH_TELEMETRY_DISABLED: '1' },
    requestTimeoutMs: 20_000,
  })
  try {
    const result = await harness.session(sessionId).run(task)
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const deadline = Date.now() + 8_000
    let events = persistedEvents(sessions)
    while (Date.now() < deadline && !events.some(event => event.type === 'session/title'
      && event.data.title === LATE_TITLE)) {
      await new Promise(resolve => setTimeout(resolve, 50))
      events = persistedEvents(sessions)
    }
    const titles = events.filter(event => event.type === 'session/title')
    expect(titles.map(event => event.data.title)).toEqual([fallback.data.title, LATE_TITLE])
    expect(titles[0]?.data.source).toEqual({ kind: 'fallback' })
    expect(titles[1]?.data.source).toMatchObject({ kind: 'provider', provider: 'session-title-first-prompt-llm',
      model: { provider: 'fixture', model: 'fixture-model' } })
    expect(events.some(event => event.type === 'session/title-llm-request'
      && event.data.titleProvider === 'session-title-first-prompt-llm'
      && typeof event.data.system === 'string' && event.data.system.startsWith(TITLE_SYSTEM))).toBe(true)
    expect(requests.filter(body => body.includes(TITLE_SYSTEM))).toHaveLength(1)
    expect(requests.filter(body => body.includes(task) && !body.includes(TITLE_SYSTEM))).toHaveLength(1)
  } finally {
    await harness.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
}, 30_000)
