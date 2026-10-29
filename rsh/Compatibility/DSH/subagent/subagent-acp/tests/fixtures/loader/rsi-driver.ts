#!/usr/bin/env node
/** Test driver: one delegation turn through a headless Loader composition. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../../../../Tests/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('rsi-subagent driver requires a config path')

const ctx = await bootProductionProfile({
  binName: 'rsi-subagent-probe',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  const result = await runFixtureTurn(ctx, { task: 'delegate to rsi' })
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await ctx.fiber.dispose()
}
