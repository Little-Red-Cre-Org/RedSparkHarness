import { afterEach, describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { NativeAgentId, type NativeAgentRegistry } from '@redspark/rsh-native-agent'
import { plugin as agentPlugin } from '@redspark/rsh-native-agent/native'
import { plugin as toolsPlugin } from '@redspark/rsh-native-tools/native'
import { plugin as promptPlugin } from '@redspark/rsh-native-prompt/native'
import type { NativeToolRegistry } from '@redspark/rsh-native-tools'
import type { NativePromptRegistry } from '@redspark/rsh-native-prompt'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@redspark/rsh-session/native'
import { ToolCallId } from '@redspark/rsh-llm/native'
import { LspProviderId, type LspProviderQuery, type LspQueryResult, type LspService } from '@redspark/rsh-lsp'
import { LSP_PROMPT_TEXT } from '@redspark/rsh-tool-lsp'
import { plugin as lspPlugin } from '../../lsp/src/native.ts'
import { plugin } from '../src/native.ts'

interface Mounted {
  lsp: LspService
  tools: NativeToolRegistry
  prompt: NativePromptRegistry
  call(args: unknown, cwd?: string): ReturnType<NativeToolRegistry['execute']>
}

const hosts: NativeHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop().catch(() => undefined)))
})

/** Mount the native tool over the real LSP seam and one or more scripted providers. */
async function mount(providers: ReadonlyArray<{
  id: string
  extensionToLanguage: Record<string, string>
  respond: (request: LspProviderQuery) => LspQueryResult
}>): Promise<Mounted & { seen: LspProviderQuery[] }> {
  const scope = new NativeScope()
  const seen: LspProviderQuery[] = []
  let agents!: NativeAgentRegistry
  let tools!: NativeToolRegistry
  let prompt!: NativePromptRegistry
  let lsp!: LspService
  const capture: NativePlugin = {
    apiVersion: 1, name: 'tool-lsp-capture', targets: ['host'],
    requires: ['agents', 'tools', 'promptSections', 'lsp'], optional: [], provides: [],
    resolve: () => (context) => {
      agents = context.require('agents')
      tools = context.require('tools')
      prompt = context.require('promptSections')
      lsp = context.require('lsp')
      for (const provider of providers) {
        context.effect(lsp.registerProvider({
          id: LspProviderId(provider.id),
          extensionToLanguage: provider.extensionToLanguage,
          query(request) {
            seen.push(request)
            return Promise.resolve(provider.respond(request))
          },
        }))
      }
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: agentPlugin, scope, config: undefined },
    { plugin: toolsPlugin, scope, config: undefined },
    { plugin: promptPlugin, scope, config: undefined },
    { plugin: lspPlugin, scope, config: undefined },
    { plugin: capture, scope, config: undefined },
    { plugin, scope, config: undefined },
  ], 'host'))
  hosts.push(host)
  await host.start()
  const agent = { id: NativeAgentId('lsp-owner'), scope }
  agents.register(agent)
  const id = SessionId('native-lsp-tool')
  let counter = 0
  return {
    lsp, tools, prompt, seen,
    call: (args, cwd = '/ws') => {
      const sessionId = SessionId(`${id}-${counter}`)
      const session = Session.create(sessionId, undefined, {
        version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false, cwd,
      })
      return tools.execute({
        agent, session, callId: ToolCallId(`call-${++counter}`), name: 'lsp', arguments: args,
        signal: new AbortController().signal,
        appendEvent: async (type, data, ...opts) => session.append(type, data, ...opts),
      })
    },
  }
}

const locations: LspQueryResult = {
  kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws',
}

describe('native tool-lsp', () => {
  it('routes each file to the provider that reserved its extension', async () => {
    const mounted = await mount([
      { id: 'ts', extensionToLanguage: { '.ts': 'typescript' }, respond: () => locations },
      { id: 'py', extensionToLanguage: { '.py': 'python' }, respond: () => ({ kind: 'hover', hover: { contents: 'py' } }) },
    ])
    const ts = await mounted.call({ operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 1 })
    const py = await mounted.call({ operation: 'hover', file_path: 'a.py', line: 2, character: 3 })
    expect(ts.isError).toBe(false)
    expect(py.content).toEqual([{ type: 'text', text: 'py' }])
    expect(mounted.seen.map(request => request.languageId)).toEqual(['typescript', 'python'])
  })

  it('forwards the four operations with one-based coordinates converted', async () => {
    const mounted = await mount([{
      id: 'ts',
      extensionToLanguage: { '.ts': 'typescript' },
      respond: request => request.operation === 'hover'
        ? { kind: 'hover', hover: { contents: 'docs' } }
        : locations,
    }])
    const operations = ['goToDefinition', 'findReferences', 'goToImplementation', 'hover'] as const
    for (const operation of operations) {
      const result = await mounted.call({ operation, file_path: 'a.ts', line: 4, character: 2 }, '/workspace')
      expect(result.isError).toBe(false)
    }
    expect(mounted.seen.map(request => request.operation)).toEqual([...operations])
    expect(mounted.seen.every(request => request.position.line === 3 && request.position.character === 1)).toBe(true)
    expect(mounted.seen.every(request => request.workspaceRoot === '/workspace')).toBe(true)
    expect(await mounted.prompt.render()).toContain(LSP_PROMPT_TEXT)
  })
})
