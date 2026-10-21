/** Real CLI acceptance for the standard profile's built-in Archify provider. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const probeModule = fileURLToPath(new URL('./fixtures/skill-probe.mjs', import.meta.url))
const dshBin = join(repoRoot, 'apps', 'cli', 'src', 'bin.ts')
const tsxEsm = pathToFileURL(createRequire(join(repoRoot, 'package.json')).resolve('tsx/esm')).href
const cleanups: Array<() => Promise<unknown>> = []

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

function runCli(
  cwd: string,
  home: string,
  args: readonly string[],
  extraEnv: Readonly<NodeJS.ProcessEnv> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', tsxEsm, dshBin, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_AGENTS_HOME: join(home, 'agents'),
      DSH_TELEMETRY_DISABLED: '1',
      ARCHIFY_UPDATE_CHECK_DISABLED: '1',
      npm_config_update_notifier: 'false',
      TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json'),
      ...extraEnv,
    },
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('Archify standard profile composition', () => {
  it('boots one hidden built-in Skill through the real headless profile loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-archify-standard-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    const probeOutput = join(root, 'probe.json')
    const probePatch = join(root, 'probe.patch.yml')
    await mkdir(workspace, { recursive: true })
    await writeFile(probePatch, [
      '- insert:',
      '    - id: archify-skill-probe',
      `      name: ${JSON.stringify(pathToFileURL(probeModule).href)}`,
      '      inject: [skills]',
      '',
    ].join('\n'))

    const dump = runCli(workspace, home, ['--profile', 'headless', '--dump-config'])
    expect(dump.status, dump.stderr || dump.stdout).toBe(0)
    expect(dump.stdout).toContain('id: archify')
    expect(dump.stdout).toContain("name: '@deepseek-ai/dsh-archify'")

    const booted = runCli(
      workspace,
      home,
      ['--profile', 'headless', '--patch', probePatch, 'probe Archify composition'],
      { ARCHIFY_DSH_PROBE_OUT: probeOutput },
    )
    expect(booted.status, booted.stderr || booted.stdout).toBe(0)
    const probe = JSON.parse(await readFile(probeOutput, 'utf8')) as {
      skills?: Array<{ name?: string; provider?: string; invocation?: { modelInvocable?: boolean; userInvocable?: boolean } }>
      definition?: {
        name?: string
        provider?: string
        contentLength?: number
        invocation?: { modelInvocable?: boolean; userInvocable?: boolean }
      }
    }
    expect(probe.skills?.filter(skill => skill.name === 'archify')).toEqual([
      { name: 'archify', provider: 'archify', invocation: { modelInvocable: false, userInvocable: true } },
    ])
    expect(probe.definition).toMatchObject({
      name: 'archify',
      provider: 'archify',
      invocation: { modelInvocable: false, userInvocable: true },
    })
    expect(probe.definition?.contentLength).toBeGreaterThan(1_000)
  }, 120_000)
})
