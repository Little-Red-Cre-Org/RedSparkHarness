import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyRuntimeClosure } from './verify-runtime-closure.ts'
import {
  SHIPPED_NATIVE_PROFILES,
  shippedNativeProfileClientComposition,
  shippedNativeProfileComposition,
} from '../Programs/CLI/src/native-profile-template.ts'

const roots: string[] = []

function fixture(files: Record<string, string | Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-closure-'))
  roots.push(root)
  for (const [relative, value] of Object.entries(files)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
  }
  return root
}

const platforms = {
  'linux-x64': { tag: 'manylinux_2_28_x86_64', executable: 'runtime-linux-x64' },
  'linux-arm64': { tag: 'manylinux_2_28_aarch64', executable: 'runtime-linux-arm64' },
  'macos-arm64': { tag: 'macosx_14_0_arm64', executable: 'runtime-macos-arm64' },
  'macos-x64': { tag: 'macosx_14_0_x86_64', executable: 'runtime-macos-x64' },
  'win-x64': { tag: 'win_amd64', executable: 'runtime-win-x64.exe' },
}

function workspace(root: string, name: string, manifest: Record<string, unknown>): void {
  const packageName = name.replace('@scope/', '')
  const path = join(root, 'rsh/Engine/core', packageName, 'package.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ name, ...manifest }, null, 2)}\n`)
}

/**
 * Every plugin a shipped profile or preset mounts, so the fixture manifest equals the closure the
 * equality check validates.
 * @returns dependency map for the runtime manifest fixture.
 */
function nativeSdkDependencies(): Record<string, string> {
  const plugins = new Set<string>()
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    for (const profile of SHIPPED_NATIVE_PROFILES) {
      const composition = shippedNativeProfileComposition('/dsh-test', profile, platform)
      for (const row of [...composition.installations, ...shippedNativeProfileClientComposition(profile)]) {
        plugins.add(row.plugin)
      }
      for (const row of shippedNativeProfileClientComposition(profile)) plugins.add(row.plugin)
    }
  }
  return Object.fromEntries([...plugins].map(plugin => [plugin, 'workspace:^']))
}

function nativeCliPlugins(): string[] {
  const plugins = new Set<string>()
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    for (const profile of SHIPPED_NATIVE_PROFILES) {
      const composition = shippedNativeProfileComposition('/dsh-test', profile, platform)
      for (const row of [...composition.installations, ...shippedNativeProfileClientComposition(profile)]) {
        plugins.add(row.plugin)
      }
    }
  }
  return [...plugins].sort()
}

function workspacePackages(root: string, names: readonly string[]): Map<string, string> {
  const paths = new Map<string, string>()
  names.forEach((name, index) => {
    const path = join(root, 'rsh/Engine/closure-fixtures', `package-${index}`, 'package.json')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ name }, null, 2)}\n`)
    paths.set(name, path)
  })
  return paths
}

function runtimeDependencies(
  overrides: Record<string, string> = {},
  missing: readonly string[] = [],
): Record<string, string> {
  const dependencies = { ...nativeSdkDependencies(), ...overrides }
  return Object.fromEntries(Object.entries(dependencies).filter(([name]) => !missing.includes(name)))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('verifyRuntimeClosure', () => {
  it('requires only plugins active for each published target', async () => {
    const root = fixture({
      'rsh/Programs/SDK/python/sdk-runtime/package.json': { name: 'runtime', dependencies: runtimeDependencies({ '@scope/shared': 'workspace:^' }) },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': platforms,
      'rsh/Engine/preset/agent-presets/presets/standard/agent.cordis.yml': `
- id: tools
  name: cordis:group
  group: true
  config:
    - id: shared
      name: '@scope/shared'
    - id: linux
      name: '@scope/linux'
      disabled: !!js process.platform !== 'linux'
    - id: macos
      name: '@scope/macos'
      disabled: !!js process.platform !== 'darwin'
    - id: windows
      name: '@scope/windows'
      disabled: !!js process.platform !== 'win32'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.presetCount).toBe(1)
    expect(result.failures).toEqual([
      'standard preset -> @scope/linux (linux-arm64, linux-x64)',
      'standard preset -> @scope/macos (macos-arm64, macos-x64)',
      'standard preset -> @scope/windows (win-x64)',
    ])
  })

  it('treats an unsupported disabled expression as active on every target', async () => {
    const root = fixture({
      'rsh/Programs/SDK/python/sdk-runtime/package.json': { name: 'runtime', dependencies: runtimeDependencies() },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': platforms,
      'rsh/Engine/preset/agent-presets/presets/standard/agent.cordis.yml': `
- id: conditional
  name: '@scope/conditional'
  disabled: !!js process.env.DSH_DISABLE_CONDITIONAL === '1'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'standard preset -> @scope/conditional (linux-arm64, linux-x64, macos-arm64, macos-x64, win-x64)',
    ])
  })

  it('does not interpret an ordinary plugin array config as nested Loader entries', async () => {
    const root = fixture({
      'rsh/Programs/SDK/python/sdk-runtime/package.json': { name: 'runtime', dependencies: runtimeDependencies({ '@scope/plugin': 'workspace:^' }) },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': platforms,
      'rsh/Engine/preset/agent-presets/presets/standard/agent.cordis.yml': `
- id: plugin
  name: '@scope/plugin'
  config:
    - name: '@scope/config-value'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([])
  })

  it('requires preset and native-sdk plugins to be linked from the workspace', async () => {
    const root = fixture({
      'rsh/Programs/SDK/python/sdk-runtime/package.json': {
        name: 'runtime',
        dependencies: runtimeDependencies(
          { '@scope/plugin': '1.2.3' },
          ['@deepseek-ai/dsh-native-sdk-server'],
        ),
      },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': platforms,
      'rsh/Engine/preset/agent-presets/presets/standard/agent.cordis.yml': `
- id: plugin
  name: '@scope/plugin'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'standard preset -> @scope/plugin [runtime dependency is "1.2.3"; expected workspace:] (linux-arm64, linux-x64, macos-arm64, macos-x64, win-x64)',
      'native-sdk profile -> @deepseek-ai/dsh-native-sdk-server (linux-arm64, linux-x64, macos-arm64, macos-x64, win-x64)',
    ])
  })

  it('fails when no shipped preset is discovered', async () => {
    const root = fixture({
      'rsh/Programs/SDK/python/sdk-runtime/package.json': { name: 'runtime', dependencies: runtimeDependencies() },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': platforms,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.presetCount).toBe(0)
    expect(result.failures).toEqual([
      'no agent presets matched rsh/Engine/preset/agent-presets/presets/*/agent.cordis.yml',
    ])
  })

  it('fails when the runtime platform manifest has no targets', async () => {
    const root = fixture({
      'rsh/Programs/SDK/python/sdk-runtime/package.json': { name: 'runtime', dependencies: runtimeDependencies() },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': {},
      'rsh/Engine/preset/agent-presets/presets/standard/agent.cordis.yml': '[]\n',
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toContain('rsh/Programs/SDK/python/sdk-runtime/platforms.json defines no runtime targets')
  })

  it('rejects a dependency no shipped profile or retained package requires', async () => {
    const root = fixture({
      'rsh/Programs/SDK/python/sdk-runtime/package.json': {
        name: 'runtime',
        dependencies: runtimeDependencies({ '@scope/legacy-bundle': 'workspace:^' }),
      },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': platforms,
      'rsh/Engine/preset/agent-presets/presets/standard/agent.cordis.yml': '[]\n',
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'runtime -> @scope/legacy-bundle is declared but no shipped profile or retained package requires it',
    ])
  })

  it('retains the required workspace-peer closure check', async () => {
    const root = fixture({
      'rsh/Programs/SDK/python/sdk-runtime/package.json': { name: 'runtime', dependencies: runtimeDependencies({ '@scope/root': 'workspace:^' }) },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': platforms,
      'rsh/Engine/preset/agent-presets/presets/minimal/agent.cordis.yml': '[]\n',
    })
    workspace(root, '@scope/root', {
      peerDependencies: { '@scope/required': 'workspace:^', '@scope/optional': 'workspace:^' },
      peerDependenciesMeta: { '@scope/optional': { optional: true } },
    })
    workspace(root, '@scope/required', {})
    workspace(root, '@scope/optional', {})

    const result = await verifyRuntimeClosure(root)

    expect(result.workspacePackageCount).toBe(1)
    expect(result.failures).toContain('runtime -> @scope/root -> @scope/required')
  })

  it('checks native CLI profile dependencies, required peers, Cordis edges, and root imports', async () => {
    const plugins = nativeCliPlugins()
    const dependencies = Object.fromEntries(plugins.map(plugin => [plugin, 'workspace:^']))
    const root = fixture({
      'rsh/Programs/CLI/package.json': {
        name: '@deepseek-ai/dsh',
        dependencies,
        optionalDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      },
      'rsh/Programs/SDK/python/sdk-runtime/platforms.json': platforms,
      'rsh/Programs/CLI/src/bin.ts': "import('@deepseek-ai/dsh-launch-environment/layers')\n",
      'rsh/Compatibility/DSH/bundle/web-app/src/index.ts': "import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess/native'\n",
    })
    const workspacePaths = workspacePackages(root, [...new Set([
      ...plugins,
      '@scope/required',
      '@deepseek-ai/dsh-api-workspace-files',
      '@deepseek-ai/dsh-typert-protocol',
      '@deepseek-ai/dsh-host-directory-picker-native',
      '@deepseek-ai/dsh-host-directory-picker',
    ])])
    const packageManifests = [
      ['@deepseek-ai/dsh-client-native-session', {
        dependencies: { '@deepseek-ai/dsh-api-workspace-files': 'workspace:^' },
      }],
      ['@deepseek-ai/dsh-api-workspace-files', {
        dependencies: { '@deepseek-ai/dsh-typert-protocol': 'workspace:^' },
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
      }],
      ['@deepseek-ai/dsh-typert-protocol', {
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
      }],
      ['@deepseek-ai/dsh-native-web-session-controller', {
        dependencies: { '@deepseek-ai/dsh-host-directory-picker-native': 'workspace:^' },
      }],
      ['@deepseek-ai/dsh-host-directory-picker-native', {
        dependencies: { '@deepseek-ai/dsh-host-directory-picker': 'workspace:^' },
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
      }],
      ['@deepseek-ai/dsh-host-directory-picker', {
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      }],
    ] as const
    for (const [name, manifest] of packageManifests) {
      const path = workspacePaths.get(name)
      if (path === undefined) throw new Error(`${name} fixture is missing`)
      writeFileSync(path, `${JSON.stringify({ name, ...manifest }, null, 2)}\n`)
    }

    const requiredPickerPeer = await verifyRuntimeClosure(root, 'rsh/Programs/CLI/package.json', 'native-cli')
    expect(requiredPickerPeer.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('@deepseek-ai/dsh-host-directory-picker -> required Cordis peer @deepseek-ai/cordis'),
    ]))

    const pickerPath = workspacePaths.get('@deepseek-ai/dsh-host-directory-picker')
    if (pickerPath === undefined) throw new Error('directory-picker fixture is missing')
    writeFileSync(pickerPath, `${JSON.stringify({
      name: '@deepseek-ai/dsh-host-directory-picker',
      peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
    }, null, 2)}\n`)
    expect((await verifyRuntimeClosure(root, 'rsh/Programs/CLI/package.json', 'native-cli')).failures).toEqual([])

    const cliPath = join(root, 'rsh/Programs/CLI/package.json')
    const cli = JSON.parse(readFileSync(cliPath, 'utf8')) as {
      dependencies: Record<string, string>
      optionalDependencies: Record<string, string>
    }
    cli.optionalDependencies['@deepseek-ai/dsh-task-scheduler'] = 'workspace:^'
    writeFileSync(cliPath, `${JSON.stringify(cli, null, 2)}\n`)

    const missingPlugin = plugins.find(plugin =>
      plugin !== '@deepseek-ai/dsh-task-scheduler' && plugin !== '@deepseek-ai/dsh-native-agent')
    if (missingPlugin === undefined) throw new Error('native CLI fixture has no other shipped plugin')
    const missingPluginPath = workspacePaths.get(missingPlugin)
    if (missingPluginPath === undefined) throw new Error(`${missingPlugin} fixture is missing`)
    rmSync(missingPluginPath)

    const nativeAgentPath = workspacePaths.get('@deepseek-ai/dsh-native-agent')
    if (nativeAgentPath === undefined) throw new Error('native-agent fixture is missing')
    writeFileSync(nativeAgentPath, `${JSON.stringify({
      name: '@deepseek-ai/dsh-native-agent',
      dependencies: { '@scope/required': 'workspace:^' },
      optionalDependencies: { '@scope/required': 'workspace:^' },
    }, null, 2)}\n`)
    const duplicateResult = await verifyRuntimeClosure(root, 'rsh/Programs/CLI/package.json', 'native-cli')
    expect(duplicateResult.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('@deepseek-ai/dsh-task-scheduler is declared in both dependencies and optionalDependencies'),
      expect.stringContaining('@deepseek-ai/dsh-native-agent -> @scope/required is declared in both dependencies and optionalDependencies'),
    ]))

    delete cli.dependencies['@deepseek-ai/dsh-task-scheduler']
    cli.optionalDependencies['@deepseek-ai/dsh-task-scheduler'] = 'workspace:^'
    writeFileSync(cliPath, `${JSON.stringify(cli, null, 2)}\n`)

    writeFileSync(nativeAgentPath, `${JSON.stringify({
      name: '@deepseek-ai/dsh-native-agent',
      peerDependencies: {
        '@deepseek-ai/cordis': 'workspace:^',
        '@scope/required': 'workspace:^',
      },
    }, null, 2)}\n`)
    writeFileSync(join(root, 'rsh/Programs/CLI/src/bin.ts'), "import('@deepseek-ai/dsh-app-boot')\n")
    writeFileSync(
      join(root, 'rsh/Compatibility/DSH/bundle/web-app/src/index.ts'),
      "import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'\n",
    )

    const result = await verifyRuntimeClosure(root, 'rsh/Programs/CLI/package.json', 'native-cli')

    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('@deepseek-ai/dsh-task-scheduler'),
      expect.stringContaining(`${missingPlugin} [workspace package not found]`),
      expect.stringContaining('required Cordis peer @deepseek-ai/cordis'),
      expect.stringContaining('@scope/required'),
      expect.stringContaining('rsh/Programs/CLI/src/bin.ts: import @deepseek-ai/dsh-app-boot'),
      expect.stringContaining('rsh/Compatibility/DSH/bundle/web-app/src/index.ts: import @deepseek-ai/dsh-subprocess'),
    ]))
  })
})
