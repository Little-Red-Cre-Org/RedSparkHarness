import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import { apply, PET_SETTINGS_NAMESPACE } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> { return Promise.resolve() }
}

describe('ui-pet host', () => {
  it('registers, validates, and disposes the durable namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.get(PET_SETTINGS_NAMESPACE)).toEqual({ enabled: true, desktopEnabled: false, petId: 'redspark-kitsune', variant: 'normal', customPets: [] })
    await ctx.settings.update(PET_SETTINGS_NAMESPACE, { enabled: false, variant: 'chibi' })
    expect(ctx.settings.get(PET_SETTINGS_NAMESPACE)).toMatchObject({ enabled: false, variant: 'chibi' })
    await expect(ctx.settings.update(PET_SETTINGS_NAMESPACE, { enabled: 'yes' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(PET_SETTINGS_NAMESPACE)
  })
})
