import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const binScript = fileURLToPath(new URL('../../../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../../../../tsconfig.host.json', import.meta.url))
const configPath = fileURLToPath(new URL('../../../../../Compatibility/DSH/bundle/rsh/cordis.patch.yml', import.meta.url))

describe('shipped RSH profile', () => {
  it('rejects a non-interactive pipe through the assembled Loader', async () => {
    const result = await runLoaderSmoke({
      label: 'RSH terminal requirement',
      tempDirPrefix: 'rsh-pipe-',
      binScript,
      configPath,
      tsconfigPath,
      binArgs: ['--profile', 'rsh'],
      expectedExitCode: 1,
      env: { DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('rsh requires an interactive terminal')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('resolves the terminal runner and preset registry from shipped bundles', async () => {
    const result = await runLoaderSmoke({
      label: 'RSH profile composition',
      tempDirPrefix: 'rsh-config-',
      binScript,
      configPath,
      tsconfigPath,
      binArgs: ['--profile', 'rsh', '--dump-config'],
      env: { DSH_TELEMETRY_DISABLED: '1' },
    })
    expect(result.stdout).toContain('@deepseek-ai/dsh-rsh')
    expect(result.stdout).toContain('@deepseek-ai/dsh-agent-presets')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
