import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { ChildConnectionDefinition } from '@deepseek-ai/dsh-subprocess/native'
import { plugin as codexPlugin } from '../src/native.ts'

it('rejects a bypass permission mode while resolving Native product configuration', () => {
  const connect = vi.fn()
  const connection = { connect } as unknown as ChildConnectionDefinition
  const scope = new NativeScope()
  const dependency: NativePlugin = {
    apiVersion: 1,
    name: 'codex-admission-test-connection',
    targets: ['host'],
    requires: [],
    provides: ['childConnection'],
    resolve: () => (context) => { context.provide('childConnection', connection) },
  }
  const config = {
    name: 'codex-test',
    permissionMode: 'dangerously-bypass-approvals-and-sandbox',
    limits: { requestBytes: 1, responseBytes: 1, jsonDepth: 1, sseEvents: 1 },
  }

  expect(() => new NativeHost(resolveInstallation([
    { plugin: codexPlugin, scope, config },
    { plugin: dependency, scope, config: undefined },
  ], 'host'))).toThrow('only permissionMode "never" is supported')
  expect(connect).not.toHaveBeenCalled()
})
