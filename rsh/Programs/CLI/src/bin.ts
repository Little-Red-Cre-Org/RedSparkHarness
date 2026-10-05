#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDshArgs } from './args.ts'
import { requireCompatibilityRuntime } from './compatibility-runtime.ts'

// Both the source tree (rsh/Programs/CLI/src) and the bundled bin (rsh/Programs/CLI/lib) sit
// one directory under rsh/Programs/CLI, so the checked-in manifest resolves with the
// same relative hop from either artifact.
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

/**
 * Run the public dsh command-line interface.
 * @returns a promise that settles when the selected command mode finishes.
 */
export async function runCli(): Promise<void> {
  const invocation = parseDshArgs(process.argv.slice(2), readVersion())

  switch (invocation.mode) {
    case 'profile': {
      const { ensureShippedNativeProfile, SHIPPED_NATIVE_PROFILES } = await import('./native-profile-template.ts')
      if (invocation.fromDefaultProfile !== undefined && (SHIPPED_NATIVE_PROFILES as readonly string[]).includes(invocation.profile)) {
        throw new Error('native profile cannot use --from-default-profile')
      }
      ensureShippedNativeProfile(invocation.profile)
      const { profileRuntime } = await import('./native-profile-config.ts')
      if (profileRuntime(invocation.profile) === 'native') {
        if (invocation.fromDefaultProfile !== undefined) throw new Error('native profile cannot use --from-default-profile')
        const { runNativeProfile } = await import('./native-profile-boot.ts')
        await runNativeProfile({ profile: invocation.profile, patchFiles: invocation.patches, args: invocation.args })
        break
      }
      requireCompatibilityRuntime()
      const { runProfile } = await import('./profile-boot.ts')
      const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot')
      await runProfile({
        environment: loadLayeredEnv('dsh'),
        profile: invocation.profile,
        fromDefaultProfile: invocation.fromDefaultProfile,
        patchFiles: invocation.patches,
        args: invocation.args,
      })
      break
    }
    case 'plugin': {
      requireCompatibilityRuntime()
      const { runPlugin } = await import('./plugin.ts')
      process.exit(runPlugin(invocation.profile, invocation.args))
      break
    }
    case 'dump-config': {
      const { ensureShippedNativeProfile, SHIPPED_NATIVE_PROFILES } = await import('./native-profile-template.ts')
      if ((SHIPPED_NATIVE_PROFILES as readonly string[]).includes(invocation.profile)) {
        if (invocation.defaultOnly) throw new Error('native profile has no bundle default to dump')
        if (invocation.fromDefaultProfile !== undefined) throw new Error('native profile cannot use --from-default-profile')
      }
      ensureShippedNativeProfile(invocation.profile)
      const { profileRuntime } = await import('./native-profile-config.ts')
      if (profileRuntime(invocation.profile) === 'native') {
        if (invocation.defaultOnly) throw new Error('native profile has no bundle default to dump')
        if (invocation.fromDefaultProfile !== undefined) throw new Error('native profile cannot use --from-default-profile')
        const { readNativeProfile } = await import('./native-profile-loader.ts')
        process.stdout.write(`${JSON.stringify(readNativeProfile({ profile: invocation.profile, patchFiles: invocation.patches }), null, 2)}\n`)
        break
      }
      requireCompatibilityRuntime()
      const { runDumpConfig } = await import('./dump-config.ts')
      runDumpConfig(
        invocation.profile,
        invocation.defaultOnly,
        invocation.patches,
        invocation.fromDefaultProfile,
      )
      break
    }
    default:
      invocation satisfies never
      throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
  }
}

if (import.meta.main) {
  await runCli()
}
