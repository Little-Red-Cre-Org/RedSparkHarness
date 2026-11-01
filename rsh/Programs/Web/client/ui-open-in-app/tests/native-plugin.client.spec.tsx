// @vitest-environment jsdom
/**
 * Native half lifecycles over the real Native runtime: the plugin assembles
 * against real `clientSlots` / `clientLocale` / `clientConnection` providers,
 * contributes into `native.conversation.actions`, and reads availability
 * through the shared Connection RPC carrier.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as renderer } from '../../ui-renderer/src/native.ts'
import { plugin as locale } from '../../locale/src/native.ts'
import { plugin as connection } from '../../connection/src/native.ts'
import { plugin } from '../src/native.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** Minimal conversation controller: the split button reads only `header.cwd`. */
const conversation = {
  getSnapshot: () => ({ header: { cwd: '/w/alpha' }, sessions: [], state: 'ready' as const }),
  subscribe: () => () => {},
}

/** Provide the one service the real providers do not: the Conversation controller. */
const conversationProvider: NativePlugin = {
  apiVersion: 1,
  name: 'test-client-native-conversation-stub',
  targets: ['client'],
  requires: [],
  provides: ['clientNativeConversation'],
  resolve: () => (context) => { context.provide('clientNativeConversation', conversation as never) },
}

/**
 * Declare `native.conversation.actions` the way the Native shell does: the
 * declaration lives in a `main` entry's `children` (native-application), and
 * this package's `slots.inject` waits for it, so a bench without it observes
 * no contribution — exactly the Cordis half's `slots.inject` semantics.
 */
const actionsDeclaration: NativePlugin = {
  apiVersion: 1,
  name: 'test-client-native-actions-declaration',
  targets: ['client'],
  requires: ['clientSlots'],
  provides: [],
  resolve: () => (context) => {
    const slots = context.require('clientSlots')
    context.own(slots.register({
      name: 'root',
      children: { 'native.conversation.actions': { kind: 'list', scope: 'root' } },
    } as never, () => null))
  },
}

const started: NativeHost[] = []

/**
 * Assemble the plugin over the real providers.
 * @param extra - additional plugins installed after this one.
 */
async function start(extra: readonly NativePlugin[] = []): Promise<NativeHost> {
  const scope = new NativeScope()
  const host = new NativeHost(resolveInstallation([
    { plugin: renderer, scope, config: undefined },
    { plugin: locale, scope, config: undefined },
    { plugin: connection, scope, config: undefined },
    { plugin: conversationProvider, scope, config: undefined },
    { plugin: actionsDeclaration, scope, config: undefined },
    { plugin, scope, config: undefined },
    ...extra.map(plugin => ({ plugin, scope, config: undefined })),
  ], 'client'))
  await host.start()
  started.push(host)
  return host
}

afterEach(async () => {
  while (started.length > 0) await started.pop()?.stop()
  vi.unstubAllGlobals()
})

describe('open-in-app native half', () => {
  it('declares the services it binds and the target it serves', () => {
    expect(plugin.apiVersion).toBe(1)
    expect(plugin.name).toBe('@deepseek-ai/dsh-client-ui-open-in-app')
    expect(plugin.targets).toEqual(['client'])
    expect(plugin.requires).toEqual(['clientSlots', 'clientLocale', 'clientConnection', 'clientNativeConversation'])
    expect(plugin.provides).toEqual([])
  })

  it('assembles over the real providers and contributes to native.conversation.actions', async () => {
    const seen: { entries(key: string): { options: { id?: string } }[] }[] = []
    const probe: NativePlugin = {
      apiVersion: 1,
      name: 'test-client-native-open-in-app-probe',
      targets: ['client'],
      requires: ['clientSlots'],
      provides: [],
      resolve: () => (context) => { seen.push(context.require('clientSlots') as never) },
    }
    await start([probe])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.entries('native.conversation.actions').map(entry => entry.options.id)).toEqual(['open-in-app'])
  })

  it('registers the open-in-app namespace in both languages', async () => {
    await start()
    expect(NS).toBe('open-in-app')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(en['open.title']).toContain('{app}')
  })

  it('teardown removes the contribution (reload safety)', async () => {
    const seen: { entries(key: string): { options: { id?: string } }[] }[] = []
    const probe: NativePlugin = {
      apiVersion: 1,
      name: 'test-client-native-open-in-app-teardown-probe',
      targets: ['client'],
      requires: ['clientSlots'],
      provides: [],
      resolve: () => (context) => { seen.push(context.require('clientSlots') as never) },
    }
    const host = await start([probe])
    expect(seen[0]?.entries('native.conversation.actions')).toHaveLength(1)
    await host.stop()
    started.pop()
    expect(seen[0]?.entries('native.conversation.actions')).toHaveLength(0)
  })
})
