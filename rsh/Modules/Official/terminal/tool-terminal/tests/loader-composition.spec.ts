import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@redspark/cordis'
import Loader from '@redspark/cordis-plugin-loader'
import Include from '@redspark/cordis-plugin-include'
import { ToolCallId } from '@redspark/rsh-llm'
import { Session, SessionId } from '@redspark/rsh-session'
import AgentRegistry from '@redspark/rsh-agent'
import type { Agent } from '@redspark/rsh-agent'
import SystemPrompt from '@redspark/rsh-system-prompt'
import ToolRuntime from '@redspark/rsh-tools'
import TerminalSessionService from '@redspark/rsh-terminal'
import SandboxProvider from '@redspark/rsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@redspark/rsh-sandbox'
import SandboxPolicyService from '@redspark/rsh-sandbox-policy'
import SessionProjectionRegistry from '@redspark/rsh-session-projection'
import LocalSubprocessRuntime from '@redspark/rsh-subprocess-local'
import * as TerminalLocal from '@redspark/rsh-terminal-bash'
import * as ToolPty from '@redspark/rsh-tool-terminal'
import { unsupportedInbox } from '@redspark/rsh-agent-loop-testkit'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@redspark/rsh-agent'",
      "- name: '@redspark/rsh-system-prompt'",
      "- name: '@redspark/rsh-tools'",
      "- name: '@redspark/rsh-terminal'",
      "- name: '@redspark/rsh-test-sandbox'",
      "- name: '@redspark/rsh-session-projection'",
      "- name: '@redspark/rsh-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@redspark/rsh-subprocess-local'",
      "- name: '@redspark/rsh-terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@redspark/rsh-tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@redspark/rsh-agent', AgentRegistry],
      ['@redspark/rsh-system-prompt', SystemPrompt],
      ['@redspark/rsh-tools', ToolRuntime],
      ['@redspark/rsh-terminal', TerminalSessionService],
      ['@redspark/rsh-test-sandbox', PassthroughSandbox],
      ['@redspark/rsh-session-projection', SessionProjectionRegistry],
      ['@redspark/rsh-sandbox-policy', SandboxPolicyService],
      ['@redspark/rsh-subprocess-local', LocalSubprocessRuntime],
      ['@redspark/rsh-terminal-bash', TerminalLocal],
      ['@redspark/rsh-tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = agent(context)
    const signal = new AbortController().signal
    const spawn = await context.tools.execute({
      signal, callId: ToolCallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await context.tools.execute({
      signal, callId: ToolCallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await context.tools.execute({
      signal, callId: ToolCallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
