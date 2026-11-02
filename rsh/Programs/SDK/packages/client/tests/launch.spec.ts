/** Public dsh launch resolution for the TypeScript SDK. */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessClient } from '../src/client.ts'
import {
  installedRshBin,
  resolveRshNodeLaunchFromManifests,
  resolveRshBinFromManifests,
  resolveRshLaunch,
} from '../src/launch.ts'
import type { RuntimeProcessOptions } from '../src/launch.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true })
})

function manifestPair(dsh: object, client: object): { rshUrl: string; clientUrl: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sdk-manifests-'))
  cleanups.push(root)
  const dshPath = join(root, 'dsh-package.json')
  const clientPath = join(root, 'client-package.json')
  writeFileSync(dshPath, JSON.stringify({ dsh: { nativeProfileTemplates: [] }, ...dsh }))
  writeFileSync(clientPath, JSON.stringify(client))
  return {
    rshUrl: pathToFileURL(dshPath).href,
    clientUrl: pathToFileURL(clientPath).href,
    root,
  }
}

describe('SDK dsh launch resolution', () => {
  it('resolves the same-version installed dsh entry by default', () => {
    const bin = installedRshBin()
    expect(bin.endsWith(join('rsh', 'Programs', 'CLI', 'lib', 'bin.js'))).toBe(true)
    const launch = resolveRshLaunch()
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toEqual(existsSync(bin)
      ? [bin, '--profile', 'sdk']
      : [
        '--import', import.meta.resolve('tsx/esm'), resolve(bin, '..', '..', 'src/bin.ts'),
        '--profile', 'sdk',
      ])
    expect(launch.initializeTimeoutMs).toBe(30_000)
    expect(launch.description).toBe('dsh profile "sdk"')
  })

  it('makes every filesystem input absolute before spawn and preserves patch order', () => {
    const caller = resolve('/tmp', 'sdk-launch-caller')
    const launch = resolveRshLaunch({
      rshBin: './bin/dsh',
      profile: 'custom-sdk',
      patches: ['./first.yml', '../second.yml'],
      rshHome: './home',
      processCwd: './worker',
      env: { PATH: '/bin', RSH_HOME: '/stale' },
      initializeTimeoutMs: 123,
      requestTimeoutMs: 456,
      shutdownTimeoutMs: 789,
      disposeEofGraceMs: 12,
      disposeGraceMs: 34,
    }, caller)
    const expectedEnvironment: NodeJS.ProcessEnv = { PATH: '/bin', RSH_HOME: join(caller, 'home') }
    if (process.platform === 'win32' && process.env.SystemRoot !== undefined) {
      expectedEnvironment.SystemRoot = process.env.SystemRoot
    }
    expect(launch).toMatchObject({
      command: process.execPath,
      args: [
        join(caller, 'bin/dsh'),
        '--profile', 'custom-sdk',
        '--patch', join(caller, 'first.yml'),
        '--patch', resolve(caller, '../second.yml'),
      ],
      cwd: join(caller, 'worker'),
      description: 'dsh profile "custom-sdk"',
      initializeTimeoutMs: 123,
      requestTimeoutMs: 456,
      shutdownTimeoutMs: 789,
      disposeEofGraceMs: 12,
      disposeGraceMs: 34,
    })
    expect(launch.environment()).toEqual(expectedEnvironment)
  })

  it('falls back to the same package source entry through an absolute tsx loader', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const sourceBin = join(pair.root, 'src/bin.ts')
    const sourceTsconfig = join(pair.root, 'tsconfig.json')
    mkdirSync(join(pair.root, 'src'))
    writeFileSync(sourceBin, '')
    writeFileSync(sourceTsconfig, '{}\n')

    expect(resolveRshNodeLaunchFromManifests(pair.rshUrl, pair.clientUrl, {
      sourceLoaderUrl: 'file:///tsx-loader.mjs',
    }))
      .toEqual({
        nodeArgs: ['--import', 'file:///tsx-loader.mjs', sourceBin],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
    expect(resolveRshNodeLaunchFromManifests(pair.rshUrl, pair.clientUrl))
      .toEqual({
        nodeArgs: ['--import', import.meta.resolve('tsx/esm'), sourceBin],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
  })

  it('uses the source entry without profile runtime prediction', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const sourceBin = join(pair.root, 'src/bin.ts')
    const sourceTsconfig = join(pair.root, 'tsconfig.json')
    mkdirSync(join(pair.root, 'src'))
    writeFileSync(sourceBin, '')
    writeFileSync(sourceTsconfig, '{}\n')
    expect(resolveRshNodeLaunchFromManifests(pair.rshUrl, pair.clientUrl, { sourceLoaderUrl: 'file:///tsx-loader.mjs' }))
      .toEqual({
        nodeArgs: ['--import', 'file:///tsx-loader.mjs', sourceBin],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
  })

  it('initializes the default SDK profile through the real CLI source entry', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-sdk-native-source-home-'))
    cleanups.push(home)
    const cliManifestUrl = new URL('../../../../CLI/package.json', import.meta.url).href
    const cliDirectory = dirname(fileURLToPath(cliManifestUrl))
    const cliManifest = JSON.parse(readFileSync(fileURLToPath(cliManifestUrl), 'utf8')) as {
      version: string
      dsh: { nativeProfileTemplates: readonly string[] }
    }
    const sourceManifestPath = join(cliDirectory, `.sdk-native-source-${randomUUID()}.json`)
    cleanups.push(sourceManifestPath)
    writeFileSync(sourceManifestPath, JSON.stringify({ version: cliManifest.version,
      bin: `lib/.missing-${randomUUID()}.js`, dsh: cliManifest.dsh }))
    const clientManifestUrl = new URL('../package.json', import.meta.url).href
    const source = resolveRshNodeLaunchFromManifests(
      pathToFileURL(sourceManifestPath).href,
      clientManifestUrl,
      { sourceLoaderUrl: import.meta.resolve('tsx/esm') },
    )
    const launch: RuntimeProcessOptions = {
      command: process.execPath,
      args: [...source.nodeArgs, '--profile', 'sdk'],
      environment: () => ({ ...process.env, RSH_HOME: home, ...source.environment }),
      description: 'dsh profile "sdk" source entry',
      initializeTimeoutMs: 30_000,
      shutdownTimeoutMs: 5_000,
    }
    const client = new HarnessClient({}, launch)
    try {
      const initialized = await client.initialize({
        cwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-v4-flash',
      })
      expect(initialized.serverInfo).toMatchObject({ name: 'redspark-harness-sdk-runtime' })
    } finally {
      await client.close()
    }
  }, 45_000)

  it('uses the built entry when the manifest bin exists', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const bin = join(pair.root, 'lib/bin.js')
    mkdirSync(join(pair.root, 'lib'))
    writeFileSync(bin, '')

    expect(resolveRshNodeLaunchFromManifests(pair.rshUrl, pair.clientUrl)).toEqual({
      nodeArgs: [bin],
      environment: {},
    })
  })

  it.each([0, 1])('fails loud when a source launch is missing required file set %s', (presentCount) => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    mkdirSync(join(pair.root, 'src'))
    const sourceFiles = ['src/bin.ts', 'tsconfig.json']
    for (const source of sourceFiles.slice(0, presentCount)) writeFileSync(join(pair.root, source), '')
    expect(() => resolveRshNodeLaunchFromManifests(pair.rshUrl, pair.clientUrl, {
      sourceLoaderUrl: 'file:///tsx-loader.mjs',
    }))
      .toThrow('is missing its built executable')
  })

  it('reads explicit and inherited environments when the child starts', () => {
    const explicit: NodeJS.ProcessEnv = { MARKER: 'before' }
    const explicitLaunch = resolveRshLaunch({ rshBin: '/bin/dsh', env: explicit })
    explicit.MARKER = 'after'
    expect(explicitLaunch.environment().MARKER).toBe('after')

    const inheritedLaunch = resolveRshLaunch({ rshBin: '/bin/dsh' })
    process.env.RSH_SDK_LATE_ENV_TEST = 'late'
    try {
      expect(inheritedLaunch.environment().RSH_SDK_LATE_ENV_TEST).toBe('late')
    } finally {
      delete process.env.RSH_SDK_LATE_ENV_TEST
    }
  })

  it('adds only the required Windows SystemRoot to an explicit child environment', () => {
    const launch = resolveRshLaunch({ rshBin: '/bin/dsh', env: { MARKER: 'explicit' } })
    const expected: NodeJS.ProcessEnv = { MARKER: 'explicit' }
    if (process.platform === 'win32' && process.env.SystemRoot !== undefined) {
      expected.SystemRoot = process.env.SystemRoot
    }
    expect(launch.environment()).toEqual(expected)
    expect(resolveRshLaunch({ rshBin: '/bin/dsh', env: { SYSTEMROOT: 'caller-root' } }).environment())
      .toEqual({ SYSTEMROOT: 'caller-root' })
  })

  it.each([2, '2.0.0'])(
    'rejects a dsh version that differs from the client (%j)',
    (version) => {
      const pair = manifestPair({ version, bin: 'bin.js' }, { version: '1.0.0' })
      expect(() => resolveRshBinFromManifests(pair.rshUrl, pair.clientUrl))
        .toThrow(`requires the same dsh version, got ${String(version)}`)
    },
  )

  it('accepts the string npm bin form', () => {
    const pair = manifestPair({ version: '1.0.0', bin: './bin.js' }, { version: '1.0.0' })
    expect(resolveRshBinFromManifests(pair.rshUrl, pair.clientUrl)).toBe(join(pair.root, 'bin.js'))
  })

  it.each([null, {}, ''])(
    'rejects a manifest without a usable dsh executable (%j)',
    (bin) => {
      const pair = manifestPair({ version: '1.0.0', bin }, { version: '1.0.0' })
      expect(() => resolveRshBinFromManifests(pair.rshUrl, pair.clientUrl))
        .toThrow('declares no dsh executable')
    },
  )
})
