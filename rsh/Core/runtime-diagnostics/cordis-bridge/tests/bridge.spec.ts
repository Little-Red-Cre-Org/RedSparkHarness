/** Hosting an unmodified Cordis plugin inside a Native activation. */
import { describe, expect, it } from 'vitest'
import type { NativeContext } from '@deepseek-ai/dsh-native-runtime'
import { hostCordisPlugin, nativePluginForCordis, type CordisPlugin } from '../src/index.ts'

/**
 * A Cordis plugin shaped like a shipped preset row: it registers through a service and
 * expects `ctx.effect()` to own the registration.
 * @param seen - records the sections it contributed.
 * @returns the plugin module.
 */
function plugin(): { name: string; apply: (ctx: never, config: never) => void } {
  return {
    name: 'probe-row',
    apply: (ctx: never, config: never) => {
      const services = ctx as unknown as {
        sink: { add(name: string, text: string): () => void }
        effect(dispose: () => void): void
      }
      const settings = config as { text: string }
      services.effect(() => services.sink.add('section', settings.text))
    },
  }
}

/**
 * A sink standing in for a Native service, recording what a bridged effect registers.
 * @returns the sink and its live rows.
 */
function sink(): { rows: Map<string, string>; service: { add(name: string, text: string): () => void } } {
  const rows = new Map<string, string>()
  return {
    rows,
    service: {
      add: (name: string, text: string) => {
        rows.set(name, text)
        return () => { rows.delete(name) }
      },
    },
  }
}

describe('hostCordisPlugin', () => {
  it('runs the plugin and disposes its effects through the returned disposer', async () => {
    const target = sink()
    const dispose = await hostCordisPlugin({
      plugin: plugin(), config: { text: 'hello' }, services: { sink: target.service },
    })

    expect(target.rows.get('section')).toBe('hello')

    await dispose()
    expect(target.rows.size).toBe(0)
  })

  it('settles repeated disposals through one fiber teardown', async () => {
    const target = sink()
    const dispose = await hostCordisPlugin({
      plugin: plugin(), config: { text: 'once' }, services: { sink: target.service },
    })

    await Promise.all([dispose(), dispose()])
    await dispose()

    expect(target.rows.size).toBe(0)
  })

  it('rejects when the plugin reads a service the bridge did not provide', async () => {
    const broken: CordisPlugin = {
      name: 'needs-sink',
      apply: (ctx: never) => { (ctx as unknown as { sink: { add(a: string, b: string): void } }).sink.add('a', 'b') },
    }

    await expect(hostCordisPlugin({ plugin: broken, config: Object.create(null) as object, services: {} }))
      .rejects.toThrow(/cannot get property "sink"/u)
  })
})

describe('nativePluginForCordis', () => {
  it('ties the Cordis fiber to the Native activation lifecycle', async () => {
    const target = sink()
    const owned: (() => Promise<void>)[] = []
    const context = {
      own: (dispose: () => Promise<void>) => { owned.push(dispose) },
    } as unknown as NativeContext

    const native = nativePluginForCordis('bridged', () => ({
      plugin: plugin(), config: { text: 'native-row' }, services: { sink: target.service },
    }))

    expect(native.apiVersion).toBe(1)
    expect(native.targets).toEqual(['host'])

    await native.resolve({ text: 'native-row' })(context)
    expect(target.rows.get('section')).toBe('native-row')
    expect(owned).toHaveLength(1)

    // Native teardown must reach the Cordis fiber.
    await owned[0]!()
    expect(target.rows.size).toBe(0)
  })
})
