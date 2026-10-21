/** Cordis access to the launcher-owned environment snapshot. */
import type { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot, type LaunchEnvironmentSnapshot } from './native.ts'

export * from './native.ts'

/** Context slot the launcher fills with this run's snapshot before any config entry mounts. */
export const DSH_LAUNCH_ENVIRONMENT_KEY = 'launchEnvironment'

/**
 * Return the launcher's snapshot, or the inherited environment as the sole
 * layer when the host provided none.
 * @param ctx - the consuming plugin's context.
 * @returns the snapshot to resolve user-facing values against.
 */
export function launchEnvironmentOf(ctx: Context): LaunchEnvironmentSnapshot {
  return ctx.get(DSH_LAUNCH_ENVIRONMENT_KEY)
    ?? createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env as Record<string, string> }])
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Launcher-owned snapshot of this run's environment; absent in compositions the product CLI did not boot. */
    launchEnvironment?: LaunchEnvironmentSnapshot
  }
}
