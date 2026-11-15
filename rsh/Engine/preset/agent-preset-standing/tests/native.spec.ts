/** Standing preset tool allowlists apply to Agents created in that scope. */
import { expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { NativeAgentId, type NativeAgentRegistry, plugin as agentPlugin } from '@redspark/rsh-native-agent'
import { plugin as toolsPlugin, type NativeToolRegistry } from '@redspark/rsh-native-tools'
import { plugin as standingPlugin } from '../src/native.ts'

function tool(name: string, description: string) {
  return {
    schema: { name, description, parameters: { type: 'object' as const, properties: {} } },
    async execute() { return { content: [], isError: false } },
  }
}

it('keeps only the named tool for Agents created in the standing scope', async () => {
  const root = new NativeScope()
  const minimal = new NativeScope(root)
  const standard = new NativeScope(root)
  const minimalAgentScope = new NativeScope(minimal)
  const standardAgentScope = new NativeScope(standard)
  let tools: NativeToolRegistry | undefined
  let agents: NativeAgentRegistry | undefined
  const presets: NativePlugin = {
    apiVersion: 1, name: 'test-presets', targets: ['host'], requires: [], provides: ['agentPresets'],
    resolve: () => (context) => {
      context.provide('agentPresets', { register: () => async () => {} } as never)
    },
  }
  const registrar: NativePlugin = {
    apiVersion: 1, name: 'test-tools', targets: ['host'], requires: ['tools'], provides: [],
    resolve: () => (context) => {
      const registry = context.require('tools')
      context.effect(registry.register(tool('read', 'read'), root))
      context.effect(registry.register(tool('bash', 'one-shot'), root))
      context.effect(registry.register(tool('bash', 'persistent'), minimal))
    },
  }
  const capture: NativePlugin = {
    apiVersion: 1, name: 'test-capture', targets: ['host'], requires: ['tools', 'agents'], provides: [],
    resolve: () => (context) => {
      tools = context.require('tools')
      agents = context.require('agents')
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: agentPlugin, scope: root, config: undefined },
    { plugin: toolsPlugin, scope: root, config: undefined },
    { plugin: presets, scope: root, config: undefined },
    { plugin: registrar, scope: root, config: undefined },
    { plugin: capture, scope: root, config: undefined },
    { plugin: standingPlugin, scope: minimal, config: {
      id: 'minimal', name: 'Minimal', allowedTools: ['bash'], compaction: false,
    } },
    { plugin: standingPlugin, scope: standard, config: {
      id: 'standard', name: 'Standard',
    } },
  ], 'host'))
  await host.start()
  try {
    if (tools === undefined || agents === undefined) throw new Error('host services were not captured')
    const releaseMinimal = agents.register({ id: NativeAgentId('minimal-agent'), scope: minimalAgentScope })
    const releaseStandard = agents.register({ id: NativeAgentId('standard-agent'), scope: standardAgentScope })
    try {
      expect(tools.schemas(minimalAgentScope)).toEqual([
        expect.objectContaining({ name: 'bash', description: 'persistent' }),
      ])
      expect(tools.schemas(standardAgentScope).map(schema => schema.name).sort()).toEqual(['bash', 'read'])
      expect(tools.schemas(standardAgentScope).find(schema => schema.name === 'bash')?.description).toBe('one-shot')
    } finally {
      await releaseMinimal()
      await releaseStandard()
    }
  } finally {
    await host.stop()
  }
})
