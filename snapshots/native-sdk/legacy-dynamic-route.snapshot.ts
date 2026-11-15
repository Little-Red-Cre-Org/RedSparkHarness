/** Recorded SDK dynamic child route replayed through a real native-sdk child process. */
import { createServer, type ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/subagent-rsh-sdk-dynamic-route')
const fixture = join(scene, 'session.v3.jsonl')
const sessionId = 'sdk-legacy-dynamic-route'
const workspaceMarker = 'SDK_DYNAMIC_ROUTE_WORKSPACE'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK dynamic route: recorded ${kind} has no text`)
  return block.text
}

function stringsIn(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value)
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, output)
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) stringsIn(item, output)
  return output
}

function finish(response: ServerResponse, content: string, tool?: { readonly id: string; readonly name: string; readonly arguments: string }): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.write('data: {"choices":[{"delta":{"role":"assistant","content":null}}]}\n\n')
  if (tool === undefined) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
  else response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: tool.id, type: 'function', function: { name: tool.name, arguments: tool.arguments } }] } }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: tool === undefined ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 5 } })}\n\n`)
  response.end('data: [DONE]\n\n')
}

function toolResultText(event: { readonly type: string; readonly data?: unknown }): string {
  if (event.type !== 'tool/result') return ''
  return stringsIn(event.data).find(text => text.startsWith('child route:')) ?? ''
}

it('replays the recorded dynamic SDK route through a real native-sdk child', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const input = inputs[0]
  if (inputs.length !== 1 || input?.type !== 'user/message') throw new Error('legacy SDK dynamic route: expected one user task')
  const task = textBlock(input.data.content, 'task')
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-route-')))
  const workspace = join(home, 'workspace')
  const profile = join(home, 'profiles', 'sdk')
  const tempRoot = join(home, 'tmp')
  const childRequests: { model?: unknown; max_tokens?: unknown; reasoning_effort?: unknown; body: string }[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const value = JSON.parse(body) as { model?: unknown; max_tokens?: unknown; reasoning_effort?: unknown }
      if (value.model === 'mock-routed') {
        childRequests.push({ ...value, body })
        const proved = value.max_tokens === 777 && value.reasoning_effort === 'max' && body.includes(workspaceMarker)
        if (!proved) {
          response.writeHead(500, { 'content-type': 'text/plain' })
          response.end(`legacy SDK dynamic route: child request did not carry the selected route: ${body.slice(0, 2000)}`)
          return
        }
        finish(response, `child route: mock/mock-routed/max/777; cwd: ${workspace}`)
        return
      }
      const childText = stringsIn(value).find(text => text.startsWith('child route:'))
      if (childText === undefined) {
        finish(response, '', {
          id: 'call-delegate', name: 'subagent',
          arguments: JSON.stringify({
            description: 'route probe', prompt: 'report your route and workspace',
            provider: 'mock', model: 'mock-routed', reasoning_effort: 'max',
          }),
        })
        return
      }
      finish(response, `child reported:\n${childText}`)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('legacy SDK dynamic route: missing model endpoint')
  mkdirSync(workspace)
  mkdirSync(join(workspace, '.git'))
  mkdirSync(tempRoot)
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(workspace, 'AGENTS.md'), `# Workspace\n${workspaceMarker}\n`)
  const composition = shippedNativeProfileComposition(home, 'native-sdk-dsh-child')
  const baseURL = `http://127.0.0.1:${address.port}/v1`
  const provider = {
    apiKeyEnv: 'MOCK_API_KEY', api: 'openai-completions', baseURL,
    compat: { supportsReasoningEffort: true, maxTokensField: 'max_tokens' },
  }
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-dynamic-route', private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: composition.installations.map(row => {
      if (row.id === 'pi-ai') return {
        ...row,
        config: { providers: {
          'deepseek-official': { ...provider, models: [{ id: 'mock-delegate', input: ['text'], contextWindow: 8192, maxTokens: 4096 }] },
          mock: { ...provider, models: [{ id: 'mock-routed', input: ['text'], contextWindow: 8192, maxTokens: 4096,
            reasoningEfforts: { max: 'max' }, compat: { supportsReasoningEffort: true, maxTokensField: 'max_tokens' } }] },
        } },
      }
      if (row.id === 'subagent-tool') return {
        ...row, config: { toolName: 'subagent', maxDepth: 3, maxTokens: 777, allowedModels: [{ provider: 'mock', model: 'mock-routed' }] },
      }
      return row
    }),
  }))
  const harness = new RedSparkHarness({
    rshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'),
    rshHome: home,
    cwd: workspace,
    provider: 'deepseek-official',
    model: 'mock-delegate',
    env: {
      ...process.env, MOCK_API_KEY: 'route-fixture', RSH_TELEMETRY_DISABLED: '1',
      TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot,
    },
    requestTimeoutMs: 90_000,
  })
  const childText = `child route: mock/mock-routed/max/777; cwd: ${workspace}`
  try {
    const result = await harness.session(sessionId).run(task)
    expect(childRequests).toHaveLength(1)
    expect(childRequests[0]).toMatchObject({ model: 'mock-routed', max_tokens: 777, reasoning_effort: 'max' })
    expect(childRequests[0]?.body).toContain(workspaceMarker)
    expect(result.events.map(toolResultText).filter(text => text.length > 0)).toEqual([childText])
    expect(result.finalResponse).toBe(`child reported:\n${childText}`)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  } finally {
    await harness.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(home, { recursive: true, force: true })
  }
}, 120_000)
