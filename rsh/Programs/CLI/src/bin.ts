#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @redspark/rsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseRshArgs } from './args.ts'
import { createNativeProfileFromTemplate, ensureShippedNativeProfile } from './native-profile-template.ts'

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
  const invocation = parseRshArgs(process.argv.slice(2), readVersion())
  if (invocation.fromDefaultProfile !== undefined) {
    createNativeProfileFromTemplate(invocation.profile, invocation.fromDefaultProfile)
  }
  ensureShippedNativeProfile(invocation.profile)
  if (invocation.mode === 'dump-config') {
    const { readNativeProfile } = await import('./native-profile-loader.ts')
    process.stdout.write(`${JSON.stringify(readNativeProfile({ profile: invocation.profile, patchFiles: invocation.patches }), null, 2)}\n`)
    return
  }
  const { runNativeProfile } = await import('./native-profile-boot.ts')
  await runNativeProfile({ profile: invocation.profile, patchFiles: invocation.patches, args: invocation.args })
}

if (import.meta.main) {
  await runCli()
}
