/** Native persistent pwsh tool over a stub terminal backend. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { NativeAgentId, type NativeAgentRegistry, plugin as agentsPlugin } from '@redspark/rsh-native-agent'
import { plugin as toolsPlugin } from '@redspark/rsh-native-tools/native'
import type { NativeToolRegistry } from '@redspark/rsh-native-tools'
import { plugin as terminalPlugin } from '@redspark/rsh-terminal/native'
import type { NativeTerminalRegistry } from '@redspark/rsh-terminal/native'
import type { TerminalReadResult, TerminalSendOperation, TerminalSendRequest } from '@redspark/rsh-terminal/protocol'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@redspark/rsh-session/native'
import { ToolCallId } from '@redspark/rsh-llm/native'
import { plugin } from '../src/native.ts'

const PREFIX = 'tool-pwsh-persistent'

interface ShellHandle {
  status: 'running' | 'exited' | 'failed'
  text: string
  spawns: number
}

function page(text: string): TerminalReadResult {
  const lines = text.length === 0 ? 0 : text.split('\n').length
  return { text, totalLines: lines, lineBegin: 0, lineEnd: lines, truncated: false }
}

function settled(text: string): TerminalSendOperation {
  return {
    done: Promise.resolve({
      viewport: text,
      waitReason: 'stdin_read',
      sessionStatus: { kind: 'running' },
      truncated: false,
    }),
    readOutput: () => ({ delta: text, truncated: false }),
    cancel: () => false,
  }
}

function remember(handle: ShellHandle, request: TerminalSendRequest): void {
  const start = /__RSH_PERSISTENT_PWSH_START_[0-9a-f-]+__/.exec(request.text)?.[0]
  const end = /__RSH_PERSISTENT_PWSH_END_[0-9a-f-]+:/.exec(request.text)?.[0]
  if (start === undefined || end === undefined) return
  handle.text = `${start}\nstub-output\n${end}0\n`
}

function backend(handle: ShellHandle): NativePlugin {
  return {
    apiVersion: 1,
    name: 'persistent-pwsh-native-test-backend',
    targets: ['host'],
    requires: ['terminals'],
    provides: [],
    resolve: () => (context) => {
      const terminals = context.require('terminals')
      context.effect(terminals.registerBackend({
        type: 'shell',
        async spawn() {
          handle.spawns += 1
          handle.status = 'running'
          handle.text = ''
          return {
            pid: 7,
            status: () => handle.status,
            async close() { handle.status = 'exited' },
            interaction: {
              motd: '',
              startSend(request: TerminalSendRequest) {
                remember(handle, request)
                return settled(handle.text)
              },
              read: () => page(handle.text),
              async signal() { return { delivered: true as const, targetPgid: 1 } },
              status: () => ({ kind: 'running' as const }),
              async close() { handle.status = 'exited' },
            },
          }
        },
      }))
    },
  }
}

function providers(scope: NativeScope, config: unknown): { plugin: NativePlugin; scope: NativeScope; config: unknown }[] {
  return [
    { plugin: agentsPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: terminalPlugin, scope, config: undefined },
    { plugin, scope, config },
  ]
}

it('rejects native configuration that is not a persistent pwsh object', () => {
  const scope = new NativeScope()
  expect(() => resolveInstallation(providers(scope, undefined), 'host')).not.toThrow()
  expect(() => resolveInstallation(providers(scope, {}), 'host')).not.toThrow()
  expect(() => resolveInstallation(providers(scope, 'nope'), 'host')).toThrow(`${PREFIX}: native configuration must be an object`)
  expect(() => resolveInstallation(providers(scope, null), 'host')).toThrow(`${PREFIX}: native configuration must be an object`)
  expect(() => resolveInstallation(providers(scope, []), 'host')).toThrow(`${PREFIX}: native configuration must be an object`)
  expect(() => resolveInstallation(providers(scope, { extra: 1 }), 'host')).toThrow(`${PREFIX}: unsupported native configuration field extra`)
  expect(() => resolveInstallation(providers(scope, { backendType: 1 }), 'host')).toThrow(`${PREFIX}: backendType must be a string`)
  expect(() => resolveInstallation(providers(scope, { timeoutMs: '1' }), 'host')).toThrow(`${PREFIX}: timeoutMs must be a number`)
  expect(() => resolveInstallation(providers(scope, { maxOutputChars: true }), 'host')).toThrow(`${PREFIX}: maxOutputChars must be a number`)
  expect(() => resolveInstallation(providers(scope, { description: 1 }), 'host')).toThrow(`${PREFIX}: description must be a string`)
  expect(() => resolveInstallation(providers(scope, { backendType: ' ' }), 'host')).toThrow(`${PREFIX}: backendType must be non-empty`)
  expect(() => resolveInstallation(providers(scope, { timeoutMs: 0 }), 'host')).toThrow(`${PREFIX}: timeoutMs must be a positive safe integer`)
  expect(() => resolveInstallation(providers(scope, { maxOutputChars: 1.5 }), 'host')).toThrow(`${PREFIX}: maxOutputChars must be a positive safe integer`)
  expect(() => resolveInstallation(providers(scope, { description: ' ' }), 'host')).toThrow(`${PREFIX}: description must be non-empty`)
})

it('reuses one native shell, resets a failed session, and ignores a missing close', async () => {
  const scope = new NativeScope()
  const handle: ShellHandle = { status: 'running', text: '', spawns: 0 }
  let services: { agents: NativeAgentRegistry; tools: NativeToolRegistry; terminals: NativeTerminalRegistry } | undefined
  const capture: NativePlugin = {
    apiVersion: 1, name: 'persistent-pwsh-native-test', targets: ['host'],
    requires: ['agents', 'tools', 'terminals'], provides: [],
    resolve: () => (context) => {
      services = { agents: context.require('agents'), tools: context.require('tools'), terminals: context.require('terminals') }
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    ...providers(scope, { backendType: 'shell', timeoutMs: 2_000, maxOutputChars: 4_000, description: 'native persistent pwsh' }),
    { plugin: backend(handle), scope, config: undefined },
  ], 'host'))
  let release: (() => Promise<void>) | undefined
  try {
    await host.start()
    if (services === undefined) throw new Error('missing test services')
    const selected = services
    const agent = { id: NativeAgentId('persistent-pwsh-owner'), scope: new NativeScope(scope) }
    release = selected.agents.register(agent)
    const id = SessionId('persistent-pwsh-owner')
    const session = Session.create(id, undefined, { id, version: SESSION_FORMAT_VERSION, createdAt: 0, cwd: '/workspace', isSeeded: false })
    let sequence = 0
    const invoke = (args: unknown) => selected.tools.executeModelCall({
      agent, session, name: 'pwsh', callId: ToolCallId(`persistent-pwsh-${++sequence}`), arguments: args,
      signal: new AbortController().signal,
      appendEvent: async (type, data, ...options) => session.append(type, data, ...options),
    })
    const text = (result: { content: readonly { type: string; text?: string }[] }) => result.content.map(part => part.text ?? '').join('\n')
    expect(selected.tools.modelSchemas(agent.scope)[0]?.description).toBe('native persistent pwsh')
    await expect(invoke({ command: '   ' })).rejects.toThrow('command must be a non-empty string')
    expect(handle.spawns).toBe(0)
    const first = await invoke({ command: 'Write-Output hi' })
    expect(first.isError).toBe(false)
    expect(text(first)).toContain('stub-output')
    expect(text(first)).not.toContain('[exit code:')
    expect(handle.spawns).toBe(1)
    await invoke({ command: 'Write-Output again' })
    expect(handle.spawns).toBe(1)
    handle.status = 'failed'
    const exited = await invoke({ command: 'Write-Output after-exit' })
    expect(text(exited)).toContain('[shell exited]')
    expect(text(exited)).toContain('The persistent pwsh shell was reset')
    expect(handle.spawns).toBe(1)
    await invoke({ command: 'Write-Output fresh' })
    expect(handle.spawns).toBe(2)
    const live = selected.terminals.list(agent)[0]
    if (live === undefined) throw new Error('missing live shell')
    await selected.terminals.close(agent, live.sessionId)
    await expect(invoke({ command: 'Write-Output gone' })).rejects.toThrow('terminal: unknown session')
    expect(handle.spawns).toBe(2)
  } finally {
    await release?.()
    await host.stop()
  }
})
