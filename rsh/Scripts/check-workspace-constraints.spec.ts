/** Experimental-package publication and dependency constraints. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkRshFamilyVersion,
  checkCordisPeerPolicy,
  checkWorkspaceManifest,
  collectRuntimeLayerViolations,
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  expectedRshPackageFiles,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

/** The workspace version the family must agree on, read rather than restated. */
const FAMILY_VERSION = (JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }).version

const experimental: WorkspaceManifest = {
  dir: 'rsh/Modules/Community/experimental/prototype',
  manifest: { name: '@redspark/rsh-experimental-prototype', private: true },
}

const publicExperimental: WorkspaceManifest = {
  dir: 'rsh/Modules/Community/experimental/agent-team',
  manifest: {
    name: '@redspark/rsh-experimental-agent-team',
    publishConfig: { access: 'public' },
  },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@redspark/rsh-prototype' },
    })).toEqual([
      '@redspark/rsh-prototype: experimental package name must start with "@redspark/rsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@redspark/rsh-experimental-prototype: experimental package must set "private": true',
      '@redspark/rsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it('requires public metadata only for the Agent Teams exceptions', () => {
    expect(checkExperimentalManifest(publicExperimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...publicExperimental,
      manifest: {
        name: '@redspark/rsh-experimental-agent-team',
        private: true,
      },
    })).toEqual([
      '@redspark/rsh-experimental-agent-team: public experimental package must not set "private": true',
      '@redspark/rsh-experimental-agent-team: public experimental package must set publishConfig.access to "public"',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'rsh/Engine/core/consumer',
        manifest: {
          name: '@redspark/rsh-consumer',
          [section]: { '@redspark/rsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@redspark/rsh-consumer: ${section}.@redspark/rsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'rsh/Engine/core/test-only',
      manifest: {
        name: '@redspark/rsh-test-only',
        devDependencies: { '@redspark/rsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'rsh/Modules/Community/experimental/consumer',
      manifest: {
        name: '@redspark/rsh-experimental-consumer',
        dependencies: { '@redspark/rsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'rsh/Programs/SDK/python/sdk-runtime',
      manifest: {
        name: '@redspark/rsh-python-runtime',
        dependencies: { '@redspark/rsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@redspark/rsh-python-runtime: dependencies.@redspark/rsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('runtime-layer constraints', () => {
  const definition: WorkspaceManifest = {
    dir: 'rsh/Modules/Official/fs/fs',
    manifest: {
      name: '@redspark/rsh-fs',
      dsh: { runtime: { apiVersion: 1, role: 'definition', capability: 'filesystem' } },
    },
  }
  const provider: WorkspaceManifest = {
    dir: 'rsh/Modules/Official/fs/fs-local',
    manifest: {
      name: '@redspark/rsh-fs-local',
      dsh: { runtime: { apiVersion: 1, role: 'provider', capability: 'filesystem' } },
    },
  }
  const consumer: WorkspaceManifest = {
    dir: 'rsh/Modules/Official/fs/tool-fs',
    manifest: {
      name: '@redspark/rsh-tool-fs',
      dsh: { runtime: { apiVersion: 1, role: 'consumer', capability: 'filesystem' } },
    },
  }

  it('allows a module Consumer to require its capability Definition', () => {
    expect(collectRuntimeLayerViolations([definition, {
      ...consumer,
      manifest: { ...consumer.manifest, peerDependencies: { '@redspark/rsh-fs': 'workspace:^' } },
    }])).toEqual([])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects a module Consumer that depends on a concrete Provider through %s',
    (section) => {
      expect(collectRuntimeLayerViolations([provider, {
        ...consumer,
        manifest: { ...consumer.manifest, [section]: { '@redspark/rsh-fs-local': 'workspace:^' } },
      }])).toEqual([
        `@redspark/rsh-tool-fs: ${section}.@redspark/rsh-fs-local violates runtime-layer policy: module Consumers may not consume module Providers`,
      ])
    },
  )

  it('rejects Core and Engine dependencies that cross their runtime ownership', () => {
    expect(collectRuntimeLayerViolations([definition, provider, {
      dir: 'rsh/Core/util/example',
      manifest: { name: '@redspark/rsh-core-example', dependencies: { '@redspark/rsh-fs': 'workspace:^' } },
    }, {
      dir: 'rsh/Engine/core/example',
      manifest: { name: '@redspark/rsh-engine-example', dependencies: { '@redspark/rsh-fs-local': 'workspace:^' } },
    }])).toEqual([
      '@redspark/rsh-core-example: dependencies.@redspark/rsh-fs violates runtime-layer policy: Core packages may not consume Engine, module, compatibility, or Program packages',
      '@redspark/rsh-engine-example: dependencies.@redspark/rsh-fs-local violates runtime-layer policy: Engine packages may not consume module Providers',
    ])
  })

  it('rejects a Module dependency on the Program-owned SDK server', () => {
    expect(collectRuntimeLayerViolations([{
      dir: 'rsh/Programs/SDK/packages/native-server',
      manifest: { name: '@redspark/rsh-native-sdk-server' },
    }, {
      dir: 'rsh/Modules/Official/subagent/codex-app-server',
      manifest: {
        name: '@redspark/rsh-codex-app-server',
        dependencies: { '@redspark/rsh-native-sdk-server': 'workspace:^' },
      },
    }])).toEqual([
      '@redspark/rsh-codex-app-server: dependencies.@redspark/rsh-native-sdk-server violates runtime-layer policy: Module packages may not consume Program packages',
    ])
  })

  it('rejects malformed runtime metadata', () => {
    expect(collectRuntimeLayerViolations([{
      dir: 'rsh/Modules/Official/fs/example',
      manifest: {
        name: '@redspark/rsh-fs-example',
        dsh: { runtime: { apiVersion: 2, role: 'unknown', capability: ' ' } },
      },
    }])).toEqual([
      '@redspark/rsh-fs-example: dsh.runtime must declare apiVersion 1, a supported role, and a non-blank capability',
    ])
  })
})
describe('dsh family version coherence', () => {

  it('rejects a package carrying a stale shared version', () => {
    expect(checkRshFamilyVersion(
      { name: '@redspark/rsh-http-proxy', version: '0.1.2-alpha.5' },
      '0.1.2-rc.1',
    )).toBe('@redspark/rsh-http-proxy: package.json version must match root version 0.1.2-rc.1')
  })

  it('rejects the root-named CLI app on a stale shared version', () => {
    expect(checkRshFamilyVersion(
      { name: '@redspark/rsh', version: '0.1.2-alpha.5' },
      '0.1.2-rc.1',
    )).toBe('@redspark/rsh: package.json version must match root version 0.1.2-rc.1')
  })

  it('accepts a manifest carrying the shared version', () => {
    expect(checkRshFamilyVersion(
      { name: '@redspark/rsh-http-proxy', version: '0.1.2-rc.1' },
      '0.1.2-rc.1',
    )).toBeUndefined()
  })

  it('leaves other sequences to their own version lines', () => {
    expect(checkRshFamilyVersion({ name: '@redspark/cordis', version: '4.0.1' }, '0.1.2-rc.1')).toBeUndefined()
    expect(checkRshFamilyVersion(
      { name: '@redspark/node-addon-system', version: '0.1.1' },
      '0.1.2-rc.1',
    )).toBeUndefined()
    expect(checkRshFamilyVersion({ version: '0.1.2-alpha.5' }, '0.1.2-rc.1')).toBeUndefined()
  })
})

describe('private Desktop compatibility assembly constraints', () => {
  const owner: WorkspaceManifest = {
    dir: 'rsh/Compatibility/DSH/boot/desktop-host-compatibility',
    manifest: {
      name: '@redspark/rsh-desktop-host-compatibility',
      version: FAMILY_VERSION,
      private: true,
      repository: {
        type: 'git',
        url: 'git+https://github.com/Little-Red-Cre-Org/RedSparkHarness.git',
        directory: 'rsh/Compatibility/DSH/boot/desktop-host-compatibility',
      },
      type: 'module',
      main: 'lib/index.js',
      types: 'lib/types/index.d.ts',
      files: ['lib/index.js', 'config/desktop.cordis.patch.yml', 'lib/types/**/*.d.ts'],
      peerDependencies: { '@redspark/cordis': 'workspace:^' },
      devDependencies: { '@redspark/cordis': 'workspace:^' },
      exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
    },
  }

  it('keeps the private assembly repository and payload exact', () => {
    expect(checkWorkspaceManifest(owner)).toEqual([])
    expect(checkWorkspaceManifest({
      ...owner,
      manifest: { ...owner.manifest, private: false },
    }).join('\n')).toContain('@redspark/rsh-desktop-host-compatibility: private Desktop assembly must set "private": true')
    expect(checkWorkspaceManifest({
      ...owner,
      manifest: { ...owner.manifest, files: ['lib/index.js', 'lib/types/**/*.d.ts'] },
    }).join('\n')).toContain('@redspark/rsh-desktop-host-compatibility: package.json files must be ["lib/index.js","config/desktop.cordis.patch.yml","lib/types/**/*.d.ts"]')
    expect(checkWorkspaceManifest({
      ...owner,
      manifest: {
        ...owner.manifest,
        repository: { ...owner.manifest.repository, directory: 'rsh/Programs/DesktopHost' },
      },
    }).join('\n')).toContain('@redspark/rsh-desktop-host-compatibility: private Desktop assembly repository must use git+https://github.com/Little-Red-Cre-Org/RedSparkHarness.git with directory rsh/Compatibility/DSH/boot/desktop-host-compatibility')
  })
})

describe('Cordis peer classification', () => {
  it.each([
    {
      name: 'application distribution and ordinary schema dependency',
      manifests: [
        { dir: 'rsh/Programs/CLI', manifest: { name: '@redspark/rsh' } },
        {
          dir: 'rsh/Programs/Web/api/native-web-session-controller',
          manifest: {
            name: '@redspark/rsh-native-web-session-controller',
            dependencies: { '@redspark/schemastery': 'workspace:^' },
          },
        },
      ],
    },
    {
      name: 'registered compatibility-only optional Cordis peer',
      manifests: [{
        dir: 'rsh/Core/typert/protocol',
        manifest: {
          name: '@redspark/rsh-typert-protocol',
          peerDependencies: { '@redspark/cordis': 'workspace:^' },
          peerDependenciesMeta: { '@redspark/cordis': { optional: true } },
          devDependencies: { '@redspark/cordis': 'workspace:^' },
        },
      }],
    },
  ] satisfies Array<{ name: string; manifests: WorkspaceManifest[] }>)('$name passes the library Cordis policy', ({ manifests }) => {
    for (const manifest of manifests) expect(checkCordisPeerPolicy(manifest)).toEqual([])
  })

  it('requires Cordis for compatibility-only packages', () => {
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Engine/core/agent-loop',
      manifest: {
        name: '@redspark/rsh-agent-loop',
        peerDependencies: { '@redspark/cordis': 'workspace:^' },
        devDependencies: { '@redspark/cordis': 'workspace:^' },
      },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Engine/core/agent-loop',
      manifest: {
        name: '@redspark/rsh-agent-loop',
        peerDependencies: { '@redspark/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@redspark/cordis': { optional: true } },
        devDependencies: { '@redspark/cordis': 'workspace:^' },
      },
    })).toContain('@redspark/rsh-agent-loop: compatibility package must keep the Cordis peer required')
  })

  it('permits Cordis-free strict native packages', () => {
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Engine/core/native-agent',
      manifest: { name: '@redspark/rsh-native-agent' },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Engine/core/native-agent',
      manifest: {
        name: '@redspark/rsh-native-agent',
        peerDependencies: { '@redspark/cordis': 'workspace:^' },
      },
    })).toContain('@redspark/rsh-native-agent: native runtime must not declare Cordis dependencies')
  })

  it('classifies the TypeScript SDK client as a Cordis-free native package', () => {
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Programs/SDK/packages/client',
      manifest: {
        name: '@redspark/rsh-sdk-client',
        dependencies: { '@redspark/rsh': 'workspace:*' },
        peerDependencies: {
          '@redspark/rsh-llm': 'workspace:^',
          '@redspark/rsh-sdk-protocol': 'workspace:^',
          '@redspark/rsh-session': 'workspace:^',
        },
        devDependencies: {
          '@redspark/rsh-llm': 'workspace:^',
          '@redspark/rsh-sdk-protocol': 'workspace:^',
          '@redspark/rsh-session': 'workspace:^',
        },
      },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Programs/SDK/packages/client',
      manifest: {
        name: '@redspark/rsh-sdk-client',
        peerDependencies: { '@redspark/cordis': 'workspace:^' },
      },
    })).toContain('@redspark/rsh-sdk-client: native runtime must not declare Cordis dependencies')
  })

  it('requires optional Cordis peers for mixed native packages', () => {
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Modules/Official/fs/fs-local',
      manifest: {
        name: '@redspark/rsh-fs-local',
        peerDependencies: { '@redspark/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@redspark/cordis': { optional: true } },
        devDependencies: { '@redspark/cordis': 'workspace:^' },
      },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Modules/Official/webhook/webhook',
      manifest: {
        name: '@redspark/rsh-webhook',
        peerDependencies: { '@redspark/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@redspark/cordis': { optional: true } },
        devDependencies: { '@redspark/cordis': 'workspace:^' },
      },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Modules/Official/fs/fs-local',
      manifest: {
        name: '@redspark/rsh-fs-local',
        peerDependencies: { '@redspark/cordis': 'workspace:^' },
        devDependencies: { '@redspark/cordis': 'workspace:^' },
      },
    })).toContain('@redspark/rsh-fs-local: mixed native package must mark the Cordis peer as optional')
  })

})

describe('package payload constraints', () => {
  /** The conditional export every published native bundle declares. */
  const nativeExport = { types: './lib/types/native.d.ts', default: './lib/native.js' }

  it('includes a runtime adapter exported as a separate bundle', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-private-runtime',
      exports: {
        './runtime': {
          types: './lib/types/runtime.d.ts',
          default: './lib/runtime.js',
        },
      },
    })).toEqual([
      'lib/index.js',
      'lib/runtime.js',
      'lib/types/**/*.d.ts',
    ])
  })

  it('includes a runtime Definition adapter exported as a separate bundle', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-private-runtime-definition',
      exports: {
        './runtime': {
          types: './lib/types/runtime-definition.d.ts',
          default: './lib/runtime-definition.js',
        },
      },
    })).toEqual([
      'lib/index.js',
      'lib/runtime-definition.js',
      'lib/types/**/*.d.ts',
    ])
  })

  it.each([
    ['@redspark/rsh-credentials', ['lib/shared-*.js']],
    ['@redspark/rsh-credentials-local', ['lib/backend.js', 'lib/shared-*.js']],
    ['@redspark/rsh-task-scheduler', ['lib/shared-*.js']],
    ['@redspark/rsh-subprocess-local', [
      'lib/child-connection.js', 'lib/shared-*.js', 'lib/runner.js', 'lib/runner-*.js', 'scripts/ensure-spawn-helper.mjs',
    ]],
    ['@redspark/rsh-settings', ['lib/shared-*.js']],
    ['@redspark/rsh-launch-environment', ['lib/layers.js', 'lib/shared-*.js']],
    ['@redspark/rsh-tool-subagent', ['lib/model-selection-settings.js', 'lib/compat-settings.js', 'lib/shared-*.js']],
    ['@redspark/rsh-client-native-application', ['lib/controller.js', 'lib/controller-*.js', 'lib/native-*.js', 'lib/*.css']],
    ['@redspark/rsh-webhook', ['lib/definition.js', 'lib/shared-*.js']],
    ['@redspark/rsh-permission-presets', ['lib/native-definition.js', 'lib/shared-*.js']],
    ['@redspark/rsh-codex-app-server', ['lib/wire.js', 'lib/shared-*.js']],
    ['@redspark/rsh-subagent-claude-code', ['lib/shared-*.js']],
    ['@redspark/rsh-tool-session-query', ['lib/shared-*.js']],
    ['@redspark/rsh-session-query-sqlite', ['lib/core.js', 'lib/shared-*.js']],
    ['@redspark/rsh-session-projection-cache', ['lib/shared-*.js']],
  ] as const)('derives the native entry beside the extra bundles of %s', (name, extras) => {
    expect(expectedRshPackageFiles({ name, exports: { './native': nativeExport } })).toEqual([
      'lib/index.js',
      'lib/native.js',
      ...extras,
      'lib/types/**/*.d.ts',
    ])
  })

  it('derives no native entry when the native subpath is the package entry', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-native-agent',
      exports: { './native': { types: './lib/types/native.d.ts', default: './lib/index.js' } },
    })).toEqual([
      'lib/index.js', 'lib/inbox.js', 'lib/consumed-work.js', 'lib/turn-boundary.js', 'lib/types/**/*.d.ts',
    ])
  })

  it('includes the emitted Workflow type module required by its root bundle', () => {
    expect(expectedRshPackageFiles({ name: '@redspark/rsh-workflow' })).toContain('lib/types.js')
  })

  it('includes the separately published Todo Client entry', () => {
    expect(expectedRshPackageFiles({ name: '@redspark/rsh-tool-todo' })).toContain('lib/client-native.js')
  })

  it('keeps the Native archive bundle beside the Client entry', () => {
    expect(expectedRshPackageFiles({ name: '@redspark/rsh-session-log-export' })).toEqual([
      'lib/index.js', 'lib/native.js', 'lib/client.js', 'lib/shared-*.js', 'lib/types/**/*.d.ts',
    ])
  })

  it('publishes the ACP child research license with its native entries', () => {
    expect(expectedRshPackageFiles({ name: '@redspark/rsh-acp-child' })).toEqual([
      'LICENSE-REDSPARK-RESEARCH.txt', 'lib/index.js', 'lib/native.js', 'lib/shared-*.js', 'lib/types/**/*.d.ts',
    ])
  })

  it('includes the Native projection bundle and emitted type runtime', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-session-projection',
      exports: {
        './types': {
          types: './lib/types/types.d.ts',
          default: './lib/types/types.js',
        },
        './native': nativeExport,
      },
    })).toEqual([
      'lib/index.js', 'lib/native.js', 'lib/shared-*.js', 'lib/types/**/*.js', 'lib/types/**/*.d.ts',
    ])
  })

  it('includes the Cordis-free sandbox native entries and shared chunks in the package', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-sandbox',
      exports: {
        './native-types': {
          types: './lib/types/native-types.d.ts',
          default: './lib/native-types.js',
        },
        './roots': { types: './lib/types/roots.d.ts', default: './lib/roots.js' },
        './native': nativeExport,
      },
    })).toEqual([
      'lib/index.js', 'lib/native.js', 'lib/native-types.js', 'lib/roots.js', 'lib/shared-*.js', 'lib/types/**/*.d.ts',
    ])
  })

  it('keeps the SDK client shared chunks while requiring exact owner package files', () => {
    expect(expectedRshPackageFiles({ name: '@redspark/rsh-sdk-client' })).toEqual([
      'lib/*.js', 'lib/types/**/*.d.ts',
    ])
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-sdk-runtime',
      exports: { './native': nativeExport },
    })).toEqual([
      'lib/index.js', 'lib/native.js', 'lib/types/**/*.d.ts',
    ])
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-sdk-child',
      exports: { './native': nativeExport },
    })).toEqual([
      'lib/index.js', 'lib/native.js', 'lib/types/**/*.d.ts',
    ])
  })

  it('derives the native bundle from the artifact path, not the subpath name', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-private-native',
      exports: { './native': nativeExport },
    })).toEqual(['lib/index.js', 'lib/native.js', 'lib/types/**/*.d.ts'])
  })

  it('leaves the tsc-emitted native tree to the emitted-tree defaults', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-private-native-tree',
      exports: {
        './native': { types: './lib/types/native.d.ts', default: './lib/types/native.js' },
      },
    })).toEqual(['lib/index.js', 'lib/types/**/*.js', 'lib/types/**/*.d.ts'])
  })

  it('derives no native bundle for a package without a native subpath', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-private-no-native',
      exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
    })).toEqual(['lib/index.js', 'lib/types/**/*.d.ts'])
  })

  it('keeps a relative stylesheet import beside the derived native bundle', () => {
    expect(expectedRshPackageFiles({
      name: '@redspark/rsh-client-ui-approval',
      exports: { './native': nativeExport },
    })).toEqual(['lib/index.js', 'lib/native.js', 'lib/**/*.css', 'lib/types/**/*.d.ts'])
  })
})
