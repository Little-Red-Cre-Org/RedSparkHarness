/**
 * A Native ACP write denied by the workspace policy, retried with an approved
 * escalation. The composition is the shipped `acp` profile with its local
 * filesystem swapped for the sandboxed one and a read-only standing policy.
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { JsonRpcLineTransport } from '@redspark/rsh-json-rpc-line'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const PROFILE = 'acp-escalation'

it('lands an approved escalation of a write the sandbox denied', async () => {
  const requests: Record<string, unknown>[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body) as { messages: readonly { role: string; content?: unknown }[] }
      requests.push(payload)
      const last = payload.messages.at(-1)
      const denied = last?.role === 'tool' && JSON.stringify(last.content).includes('sandbox: file access denied')
      const settled = last?.role === 'tool' && !denied
      const call = (args: Record<string, unknown>): Record<string, unknown>[] => [
        { choices: [{ delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'escalating-write', type: 'function',
          function: { name: 'write', arguments: JSON.stringify(args) } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]
      const events = settled
        ? [{ choices: [{ delta: { role: 'assistant', content: 'DONE' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }] }]
        : call(denied
          ? { file_path: 'escalated.txt', content: 'ACP_ESCALATION_OK\n', sandbox_permissions: 'workspace-write',
            justification: 'the user asked to escalate this write' }
          : { file_path: 'escalated.txt', content: 'ACP_ESCALATION_OK\n' })
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('native-acp escalation: missing model endpoint')
  const home = mkdtempSync(join(tmpdir(), 'dsh-native-acp-escalation-'))
  const workspace = join(home, 'workspace')
  const profileDir = join(home, 'profiles', PROFILE)
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  mkdirSync(join(workspace, 'inner'))
  mkdirSync(profileDir, { recursive: true })
  const composition = shippedNativeProfileComposition(home, 'native-acp')
  const installations = composition.installations.map(row => row.id === 'fs'
    ? { ...row, plugin: '@redspark/rsh-fs-sandbox' }
    : row)
  const fsIndex = installations.findIndex(row => row.id === 'fs')
  installations.splice(fsIndex, 0,
    { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
      config: { mode: 'read-only', workspaceRoot: workspace } },
    { id: 'policy', plugin: '@redspark/rsh-fs-observation-policy', scope: 'root' })
  installations.splice(fsIndex + 3, 0, { id: 'file-tools', plugin: '@redspark/rsh-tool-fs', scope: 'root' })
  writeFileSync(join(profileDir, 'rsh.profile.json'), `${JSON.stringify({ ...composition, installations }, null, 2)}\n`)
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`, private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json', configReload: 'startup' } },
  }, null, 2)}\n`)
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { provider: 'fixture', model: 'fixture-model', systemPrompt: 'You are a native ACP fixture.', maxSteps: 4 } },
    { id: 'storage', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'pi-ai', config: { providers: { fixture: { apiKeyEnv: 'NATIVE_SDK_FIXTURE_KEY', api: 'openai-completions',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      models: [{ id: 'fixture-model', input: ['text'] }] } } } },
  ] }))
  const child = execa(process.execPath, [join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', PROFILE, '--patch', patch], {
    cwd: workspace, env: { ...process.env, RSH_HOME: home, NATIVE_SDK_FIXTURE_KEY: 'fixture-key', RSH_TELEMETRY_DISABLED: '1' },
    reject: false, timeout: 30_000, killSignal: 'SIGKILL',
  })
  const transport = new JsonRpcLineTransport(child.stdout, child.stdin)
  const output: Record<string, unknown>[] = []
  const permissionRequests: Record<string, unknown>[] = []
  transport.onNotification((method, params) => {
    if (method === 'session/update') output.push(params.update as Record<string, unknown>)
  })
  transport.onRequest((method, params) => {
    expect(method).toBe('session/request_permission')
    permissionRequests.push(params as Record<string, unknown>)
    return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
  })
  transport.start()
  const signal = AbortSignal.timeout(20_000)
  try {
    await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {} }, signal)
    const created = await transport.request('session/new', { cwd: workspace, mcpServers: [] }, signal) as { sessionId: string }
    const prompted = await transport.request('session/prompt', { sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'Write escalated.txt, escalating the write if the sandbox denies it.' }] }, signal)
    expect(prompted).toMatchObject({ stopReason: 'end_turn' })
    console.error('DEBUG', JSON.stringify(output))
    console.error('DEBUGREQ', requests.length)
    const landed = join(workspace, 'escalated.txt')
    expect(existsSync(landed)).toBe(true)
    expect(existsSync(landed) && readFileSync(landed, 'utf8')).toBe('ACP_ESCALATION_OK\n')

    const tools = (requests[0]?.tools ?? []) as readonly { name?: string; function?: { name?: string;
      parameters?: { properties?: Record<string, unknown> } } }[]
    expect(tools.find(tool => (tool.function?.name ?? tool.name) === 'write')?.function?.parameters?.properties)
      .toMatchObject({ sandbox_permissions: { enum: ['workspace-write', 'danger-full-access'] } })
    const afterDenial = JSON.stringify(requests[1])
    expect(afterDenial).toContain('sandbox: file access denied')
    expect(afterDenial).toContain('retry this exact operation once with sandbox_permissions')
    const escalated = (requests[2]?.messages as readonly { tool_calls?: readonly { function: { arguments: string } }[] }[] | undefined ?? [])
      .flatMap(message => message.tool_calls ?? [])
      .map(call => JSON.parse(call.function.arguments) as Record<string, unknown>)
      .find(args => args.sandbox_permissions !== undefined)
    expect(escalated).toMatchObject({ file_path: 'escalated.txt', sandbox_permissions: 'workspace-write',
      justification: 'the user asked to escalate this write' })
    expect(permissionRequests.length).toBeGreaterThanOrEqual(2)
    expect(output.filter(update => update.toolCallId === 'escalating-write').at(-1))
      .toMatchObject({ sessionUpdate: 'tool_call_update', status: 'completed' })

    await transport.request('session/close', { sessionId: created.sessionId }, signal)
  } finally {
    child.kill('SIGKILL')
    server.close()
  }
})
