import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import { SessionId } from '@deepseek-ai/dsh-session/native'
import type { NativeExternalSubagentDriver, NativeExternalSubagentRequest } from '@deepseek-ai/dsh-native-subagent/native'
import { plugin as codexPlugin } from '../src/native.ts'

type RequestWithAuthority = NativeExternalSubagentRequest & {
  readonly authority: {
    readonly toolNames: readonly string[]
    readonly builtinToolNames: readonly string[]
    readonly sandboxPolicy: {
      readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'
      readonly workspaceRoot: string
    }
    readonly approvalRequired: boolean
  }
}

it('refuses a restrictive Native request before a bypass-configured product can connect', async () => {
  const connect = vi.fn()
  const connection = { connect } as unknown as ChildConnectionDefinition
  const scope = new NativeScope()
  let driver: NativeExternalSubagentDriver | undefined
  const dependency: NativePlugin = {
    apiVersion: 1,
    name: 'codex-admission-test-connection',
    targets: ['host'],
    requires: [],
    provides: ['childConnection'],
    resolve: () => (context) => { context.provide('childConnection', connection) },
  }
  const capture: NativePlugin = {
    apiVersion: 1,
    name: 'codex-admission-test-capture',
    targets: ['host'],
    requires: ['externalSubagentDriver'],
    provides: [],
    resolve: () => (context) => { driver = context.require('externalSubagentDriver') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: capture, scope, config: undefined },
    { plugin: codexPlugin, scope, config: { name: 'codex-test', permissionMode: 'dangerously-bypass-approvals-and-sandbox' } },
    { plugin: dependency, scope, config: undefined },
  ], 'host'))

  try {
    await host.start()
    if (driver === undefined) throw new Error('Native composition did not publish the Codex driver')
    const request: RequestWithAuthority = {
      id: 'external-test' as NativeExternalSubagentRequest['id'],
      parentSessionId: SessionId('parent-session'),
      rootSessionId: SessionId('parent-session'),
      parentEpoch: 'parent-epoch',
      rootEpoch: 'root-epoch',
      parentDepth: 0,
      maxDepth: 1,
      limits: { maxSteps: 1, maxTokens: 1 },
      authority: {
        toolNames: [],
        builtinToolNames: [],
        sandboxPolicy: { mode: 'read-only', workspaceRoot: process.cwd() },
        approvalRequired: true,
      },
      label: 'bounded request',
      cwd: process.cwd(),
      prompt: [{ type: 'text', text: 'Read-only task.' }],
      route: { provider: 'codex', model: 'fixture-model', overrides: {} },
    }

    await expect(driver.start(request, new AbortController().signal)).rejects.toThrow(
      'cannot enforce Native parent authority or execution ceilings',
    )
    expect(connect).not.toHaveBeenCalled()
  } finally {
    await host.stop()
  }
})
