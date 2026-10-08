/** Public dsh launch resolution for the TypeScript SDK. */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { HarnessClient } from '../src/client.ts'
import {
  installedDshBin,
  resolveDshNodeLaunchFromManifests,
  resolveDshBinFromManifests,
  resolveDshLaunch,
} from '../src/launch.ts'
import type { RuntimeProcessOptions } from '../src/launch.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const path of cleanups.splice(0)) rmSync(path, { recursive: true, force: true })
})

function manifestPair(dsh: object, client: object): { dshUrl: string; clientUrl: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sdk-manifests-'))
  cleanups.push(root)
  const dshPath = join(root, 'dsh-package.json')
  const clientPath = join(root, 'client-package.json')
  writeFileSync(dshPath, JSON.stringify({ dsh: { nativeProfileTemplates: [] }, ...dsh }))
  writeFileSync(clientPath, JSON.stringify(client))
  return {
    dshUrl: pathToFileURL(dshPath).href,
    clientUrl: pathToFileURL(clientPath).href,
    root,
  }
}

describe('SDK dsh launch resolution', () => {
  it('resolves the same-version installed dsh entry by default', () => {
    const bin = installedDshBin()
    expect(bin.endsWith(join('rsh', 'Programs', 'CLI', 'lib', 'bin.js'))).toBe(true)
    const launch = resolveDshLaunch()
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toEqual(existsSync(bin)
      ? [bin, '--profile', 'sdk']
      : [
        '--import', import.meta.resolve('tsx/esm'), resolve(bin, '..', '..', 'src/bin.ts'),
        '--profile', 'sdk',
        '--patch', resolve(bin, '..', '..', 'src/sdk-source.cordis.patch.yml'),
      ])
    expect(launch.initializeTimeoutMs).toBe(30_000)
    expect(launch.description).toBe('dsh profile "sdk"')
  })

  it('makes every filesystem input absolute before spawn and preserves patch order', () => {
    const caller = resolve('/tmp', 'sdk-launch-caller')
    const launch = resolveDshLaunch({
      dshBin: './bin/dsh',
      profile: 'custom-sdk',
      patches: ['./first.yml', '../second.yml'],
      dshHome: './home',
      processCwd: './worker',
      env: { PATH: '/bin', DSH_HOME: '/stale' },
      initializeTimeoutMs: 123,
      requestTimeoutMs: 456,
      shutdownTimeoutMs: 789,
      disposeEofGraceMs: 12,
      disposeGraceMs: 34,
    }, caller)
    const expectedEnvironment: NodeJS.ProcessEnv = { PATH: '/bin', DSH_HOME: join(caller, 'home') }
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
    const sourcePatch = join(pair.root, 'src/sdk-source.cordis.patch.yml')
    const sourceTsconfig = join(pair.root, 'tsconfig.json')
    mkdirSync(join(pair.root, 'src'))
    writeFileSync(sourceBin, '')
    writeFileSync(sourcePatch, '[]\n')
    writeFileSync(sourceTsconfig, '{}\n')

    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, {
      dshHome: pair.root, sourceLoaderUrl: 'file:///tsx-loader.mjs',
    }))
      .toEqual({
        nodeArgs: ['--import', 'file:///tsx-loader.mjs', sourceBin],
        patches: [sourcePatch],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, { dshHome: pair.root }))
      .toEqual({
        nodeArgs: ['--import', import.meta.resolve('tsx/esm'), sourceBin],
        patches: [sourcePatch],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
  })

  it('uses a Native source entry without requiring or passing the Cordis YAML patch', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js',
      dsh: { nativeProfileTemplates: ['native-sdk'] } }, { version: '1.0.0' })
    const sourceBin = join(pair.root, 'src/bin.ts')
    const sourceTsconfig = join(pair.root, 'tsconfig.json')
    mkdirSync(join(pair.root, 'src'))
    writeFileSync(sourceBin, '')
    writeFileSync(sourceTsconfig, '{}\n')
    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, {
      dshHome: pair.root, profile: 'native-sdk', sourceLoaderUrl: 'file:///tsx-loader.mjs',
    }))
      .toEqual({
        nodeArgs: ['--import', 'file:///tsx-loader.mjs', sourceBin],
        patches: [],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
  })

  it.each([
    { profile: 'custom-sdk', marker: { runtime: 'native', config: 'rsh.profile.json' }, patch: false },
    { profile: 'native-custom', marker: {}, patch: true },
  ] as const)('uses the profile marker rather than its spelling for $profile', ({ profile, marker, patch }) => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const home = mkdtempSync(join(tmpdir(), 'dsh-sdk-profile-runtime-'))
    cleanups.push(home)
    const profileDir = join(home, 'profiles', profile)
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: marker } }))
    const sourceBin = join(pair.root, 'src/bin.ts')
    const sourcePatch = join(pair.root, 'src/sdk-source.cordis.patch.yml')
    const sourceTsconfig = join(pair.root, 'tsconfig.json')
    mkdirSync(join(pair.root, 'src'))
    writeFileSync(sourceBin, '')
    writeFileSync(sourceTsconfig, '{}\n')
    if (patch) writeFileSync(sourcePatch, '[]\n')

    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, {
      profile, dshHome: home, environment: {}, sourceLoaderUrl: 'file:///tsx-loader.mjs',
    }))
      .toEqual({
        nodeArgs: ['--import', 'file:///tsx-loader.mjs', sourceBin],
        patches: patch ? [sourcePatch] : [],
        environment: { TSX_TSCONFIG_PATH: sourceTsconfig },
      })
  })

  it('initializes the shipped Native profile through the real CLI source entry', async () => {
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
    const source = resolveDshNodeLaunchFromManifests(
      pathToFileURL(sourceManifestPath).href,
      clientManifestUrl,
      { profile: 'native-sdk', dshHome: home, environment: {}, sourceLoaderUrl: import.meta.resolve('tsx/esm') },
    )
    expect(source.patches).toEqual([])

    const launch: RuntimeProcessOptions = {
      command: process.execPath,
      args: [...source.nodeArgs, '--profile', 'native-sdk'],
      environment: () => ({ ...process.env, DSH_HOME: home, ...source.environment }),
      description: 'dsh profile "native-sdk" source entry',
      initializeTimeoutMs: 30_000,
      shutdownTimeoutMs: 5_000,
    }
    const client = new HarnessClient({ profile: 'native-sdk' }, launch)
    try {
      const initialized = await client.initialize({
        cwd: process.cwd(), provider: 'deepseek-official', model: 'deepseek-v4-flash',
      })
      expect(initialized.serverInfo).toMatchObject({ name: 'deepseek-harness-sdk-runtime' })
    } finally {
      await client.close()
    }
  }, 45_000)

  it('uses the built entry when the manifest bin exists', () => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    const bin = join(pair.root, 'lib/bin.js')
    mkdirSync(join(pair.root, 'lib'))
    writeFileSync(bin, '')

    expect(resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, { dshHome: pair.root })).toEqual({
      nodeArgs: [bin],
      patches: [],
      environment: {},
    })
  })

  it.each([0, 1, 2])('fails loud when a source launch is missing required file set %s', (presentCount) => {
    const pair = manifestPair({ version: '1.0.0', bin: 'lib/bin.js' }, { version: '1.0.0' })
    mkdirSync(join(pair.root, 'src'))
    const sourceFiles = ['src/bin.ts', 'src/sdk-source.cordis.patch.yml', 'tsconfig.json']
    for (const source of sourceFiles.slice(0, presentCount)) writeFileSync(join(pair.root, source), '')
    expect(() => resolveDshNodeLaunchFromManifests(pair.dshUrl, pair.clientUrl, {
      dshHome: pair.root, sourceLoaderUrl: 'file:///tsx-loader.mjs',
    }))
      .toThrow('is missing its built executable')
  })

  it('reads explicit and inherited environments when the child starts', () => {
    const explicit: NodeJS.ProcessEnv = { MARKER: 'before' }
    const explicitLaunch = resolveDshLaunch({ dshBin: '/bin/dsh', env: explicit })
    explicit.MARKER = 'after'
    expect(explicitLaunch.environment().MARKER).toBe('after')

    const inheritedLaunch = resolveDshLaunch({ dshBin: '/bin/dsh' })
    process.env.DSH_SDK_LATE_ENV_TEST = 'late'
    try {
      expect(inheritedLaunch.environment().DSH_SDK_LATE_ENV_TEST).toBe('late')
    } finally {
      delete process.env.DSH_SDK_LATE_ENV_TEST
    }
  })

  it('adds only the required Windows SystemRoot to an explicit child environment', () => {
    const launch = resolveDshLaunch({ dshBin: '/bin/dsh', env: { MARKER: 'explicit' } })
    const expected: NodeJS.ProcessEnv = { MARKER: 'explicit' }
    if (process.platform === 'win32' && process.env.SystemRoot !== undefined) {
      expected.SystemRoot = process.env.SystemRoot
    }
    expect(launch.environment()).toEqual(expected)
    expect(resolveDshLaunch({ dshBin: '/bin/dsh', env: { SYSTEMROOT: 'caller-root' } }).environment())
      .toEqual({ SYSTEMROOT: 'caller-root' })
  })

  it.each([2, '2.0.0'])(
    'rejects a dsh version that differs from the client (%j)',
    (version) => {
      const pair = manifestPair({ version, bin: 'bin.js' }, { version: '1.0.0' })
      expect(() => resolveDshBinFromManifests(pair.dshUrl, pair.clientUrl))
        .toThrow(`requires the same dsh version, got ${String(version)}`)
    },
  )

  it('accepts the string npm bin form', () => {
    const pair = manifestPair({ version: '1.0.0', bin: './bin.js' }, { version: '1.0.0' })
    expect(resolveDshBinFromManifests(pair.dshUrl, pair.clientUrl)).toBe(join(pair.root, 'bin.js'))
  })

  it.each([null, {}, ''])(
    'rejects a manifest without a usable dsh executable (%j)',
    (bin) => {
      const pair = manifestPair({ version: '1.0.0', bin }, { version: '1.0.0' })
      expect(() => resolveDshBinFromManifests(pair.dshUrl, pair.clientUrl))
        .toThrow('declares no dsh executable')
    },
  )
})
