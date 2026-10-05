/** Real native terminal Consumer over the existing local PTY implementation. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeAgentId, type NativeAgentRegistry, plugin as agentsPlugin } from '@deepseek-ai/dsh-native-agent'
import { NativeJobId, type NativeJobRegistry, plugin as jobsPlugin } from '@deepseek-ai/dsh-native-jobs'
import { plugin as toolsPlugin } from '@deepseek-ai/dsh-native-tools/native'
import type { NativeToolRegistry } from '@deepseek-ai/dsh-native-tools'
import { plugin as terminalPlugin } from '@deepseek-ai/dsh-terminal/native'
import { plugin as backendPlugin } from '@deepseek-ai/dsh-terminal-bash/native'
import { plugin as subprocessPlugin } from '@deepseek-ai/dsh-subprocess-local/native'
import { plugin as policyPlugin } from '@deepseek-ai/dsh-native-sandbox-policy/native'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { ToolCallId } from '@deepseek-ai/dsh-llm/native'
import { plugin } from '../src/native.ts'

it('preserves interactive state and cancels a native background send before awaited close', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'rsh-native-terminal-'))
  const scope = new NativeScope()
  let services: { agents: NativeAgentRegistry; tools: NativeToolRegistry; jobs: NativeJobRegistry } | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'terminal-test', targets: ['host'], requires: ['agents', 'tools', 'jobs'], provides: [],
    resolve: () => (context) => { services = { agents: context.require('agents'), tools: context.require('tools'), jobs: context.require('jobs') } },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined }, { plugin, scope, config: { type: 'shell', maxResultBytes: 2048 } },
    { plugin: terminalPlugin, scope, config: undefined }, { plugin: toolsPlugin, scope, config: undefined },
    { plugin: jobsPlugin, scope, config: { maxConcurrentPerAgent: 2 } }, { plugin: agentsPlugin, scope, config: undefined },
    { plugin: subprocessPlugin, scope, config: undefined },
    { plugin: policyPlugin, scope, config: { mode: 'danger-full-access', workspaceRoot: cwd } },
    { plugin: backendPlugin, scope, config: { type: 'shell', shellDialect: process.platform === 'win32' ? 'pwsh' : 'bash',
      idleSilenceMs: 500, pollIntervalMs: 20, timeoutMs: 5000, graceMs: 500 } },
  ], 'host'))
  let release: (() => Promise<void>) | undefined
  try {
    await host.start()
    if (services === undefined) throw new Error('missing test services')
    const selected = services
    const agent = { id: NativeAgentId('terminal-owner'), scope: new NativeScope(scope) }
    release = selected.agents.register(agent)
    const id = SessionId('terminal-owner')
    const session = Session.create(id, undefined, { id, version: SESSION_FORMAT_VERSION, createdAt: 0, cwd, isSeeded: false })
    let sequence = 0
    const invoke = (name: string, args: unknown) => selected.tools.executeModelCall({
      agent, session, name, callId: ToolCallId(`native-terminal-${++sequence}`), arguments: args,
      signal: new AbortController().signal,
      appendEvent: async (type, data, ...options) => session.append(type, data, ...options),
    })
    const opened = await invoke('terminal_open', { type: 'shell' })
    expect(opened.isError).toBe(false)
    const terminalId = (opened.value as { sessionId: string }).sessionId
    const sent = await invoke('terminal_send', { sessionId: terminalId, text: 'echo RSH_INTERACTIVE' })
    expect(sent.isError).toBe(false)
    expect(JSON.stringify(sent.content)).toContain('RSH_INTERACTIVE')
    const read = await invoke('terminal_read', { sessionId: terminalId, count: 10 })
    expect(JSON.stringify(read.content)).toContain('RSH_INTERACTIVE')
    await expect(invoke('terminal_signal', { sessionId: terminalId, signal: 'SIGKILL' })).rejects.toThrow('refusing to SIGKILL')
    const sleeping = process.platform === 'win32' ? "Write-Output ('RSH_' + 'LIVE'); Start-Sleep -Seconds 30"
      : "printf 'RSH_%s\\n' LIVE; sleep 30"
    const background = await invoke('terminal_send', { sessionId: terminalId, text: sleeping, run_in_background: true })
    expect(background.isError).toBe(false)
    const jobId = NativeJobId((background.value as { jobId: string }).jobId)
    await expect.poll(() => selected.jobs.read(jobId, agent).output, { timeout: 3000 }).toContain('RSH_LIVE')
    expect(selected.jobs.get(jobId, agent).status).toBe('running')
    expect(selected.jobs.cancel(jobId, agent)).toBe('requested')
    expect((await selected.jobs.wait(jobId, agent, 5000)).status).toBe('cancelled')
    expect((await invoke('terminal_close', { sessionId: terminalId })).isError).toBe(false)
  } finally {
    await release?.()
    await host.stop()
    await rm(cwd, { recursive: true, force: true })
  }
}, 20_000)
