/** Recorded SDK inline-image turn replayed through the shipped dsh --profile sdk. */
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/inline-image-prompt')
const fixture = join(scene, 'session.v3.jsonl')
const sessionId = 'sdk-legacy-inline-image'
const IMAGE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
const LEAD = 'Inspect this image, then reply with exactly'
const TAIL = 'the single word DONE.'
const REPLY = 'DONE'

function respond(response: ServerResponse, content: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    JSON.stringify({ choices: [{ delta: { role: 'assistant', content } }] }),
    JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    '[DONE]',
  ].map(chunk => `data: ${chunk}\n\n`).join(''))
}

it('replays the recorded SDK inline image through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const input = inputs[0]
  if (inputs.length !== 1 || input?.type !== 'user/message') throw new Error('legacy SDK inline image: expected one user task')
  const image = input.data.content.find(block => block.type === 'image')
  if (image?.type !== 'image' || image.attachment.mediaType !== 'image/png') {
    throw new Error('legacy SDK inline image: recorded image block missing')
  }
  const answer = recorded.find(event => event.type === 'assistant/message')
  if (answer?.type !== 'assistant/message' || answer.data.message.content[0]?.type !== 'text'
    || answer.data.message.content[0].text !== REPLY) {
    throw new Error('legacy SDK inline image: recorded reply is not DONE')
  }

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-image-')))
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
      const imageReached = body.includes(`data:image/png;base64,${IMAGE}`)
      if (!body.includes(LEAD) || !body.includes(TAIL) || !imageReached) {
        response.writeHead(500)
        response.end(`legacy SDK inline image: model request missing lead=${body.includes(LEAD)} tail=${body.includes(TAIL)} image=${imageReached}`)
        return
      }
      respond(response, REPLY)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('legacy SDK inline image: missing model endpoint')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-inline-image',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify(shippedNativeProfileComposition(home, 'sdk')))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'Reply to the recorded SDK task.', maxSteps: 2 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'fs', config: { cwd: workspace } },
    { id: 'pi-ai', config: { providers: { fixture: {
      apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY',
      api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      models: [{ id: 'fixture-model', input: ['text', 'image'] }],
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
    const result = await harness.session(sessionId).run([
      { type: 'text', text: `${LEAD} ` },
      { type: 'image', data: IMAGE, mimeType: 'image/png' },
      { type: 'text', text: TAIL },
    ])
    expect(result.finalResponse).toBe(REPLY)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(requests).toHaveLength(1)
  } finally {
    await harness.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
}, 30_000)
