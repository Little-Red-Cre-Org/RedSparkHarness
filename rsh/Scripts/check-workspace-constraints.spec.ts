/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkDshFamilyVersion,
  checkCordisPeerPolicy,
  collectRuntimeLayerViolations,
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  expectedDshPackageFiles,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'rsh/Modules/Community/experimental/prototype',
  manifest: { name: '@deepseek-ai/dsh-experimental-prototype', private: true },
}

const publicExperimental: WorkspaceManifest = {
  dir: 'rsh/Modules/Community/experimental/agent-team',
  manifest: {
    name: '@deepseek-ai/dsh-experimental-agent-team',
    publishConfig: { access: 'public' },
  },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@deepseek-ai/dsh-prototype' },
    })).toEqual([
      '@deepseek-ai/dsh-prototype: experimental package name must start with "@deepseek-ai/dsh-experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-prototype: experimental package must set "private": true',
      '@deepseek-ai/dsh-experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it('requires public metadata only for the Agent Teams exceptions', () => {
    expect(checkExperimentalManifest(publicExperimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...publicExperimental,
      manifest: {
        name: '@deepseek-ai/dsh-experimental-agent-team',
        private: true,
      },
    })).toEqual([
      '@deepseek-ai/dsh-experimental-agent-team: public experimental package must not set "private": true',
      '@deepseek-ai/dsh-experimental-agent-team: public experimental package must set publishConfig.access to "public"',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'rsh/Engine/core/consumer',
        manifest: {
          name: '@deepseek-ai/dsh-consumer',
          [section]: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@deepseek-ai/dsh-consumer: ${section}.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'rsh/Engine/core/test-only',
      manifest: {
        name: '@deepseek-ai/dsh-test-only',
        devDependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'rsh/Modules/Community/experimental/consumer',
      manifest: {
        name: '@deepseek-ai/dsh-experimental-consumer',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'rsh/Programs/SDK/python/sdk-runtime',
      manifest: {
        name: '@deepseek-ai/dsh-python-runtime',
        dependencies: { '@deepseek-ai/dsh-experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@deepseek-ai/dsh-python-runtime: dependencies.@deepseek-ai/dsh-experimental-prototype must not reference an experimental package',
    ])
  })
})

describe('runtime-layer constraints', () => {
  const definition: WorkspaceManifest = {
    dir: 'rsh/Modules/Official/fs/fs',
    manifest: {
      name: '@deepseek-ai/dsh-fs',
      dsh: { runtime: { apiVersion: 1, role: 'definition', capability: 'filesystem' } },
    },
  }
  const provider: WorkspaceManifest = {
    dir: 'rsh/Modules/Official/fs/fs-local',
    manifest: {
      name: '@deepseek-ai/dsh-fs-local',
      dsh: { runtime: { apiVersion: 1, role: 'provider', capability: 'filesystem' } },
    },
  }
  const consumer: WorkspaceManifest = {
    dir: 'rsh/Modules/Official/fs/tool-fs',
    manifest: {
      name: '@deepseek-ai/dsh-tool-fs',
      dsh: { runtime: { apiVersion: 1, role: 'consumer', capability: 'filesystem' } },
    },
  }

  it('allows a module Consumer to require its capability Definition', () => {
    expect(collectRuntimeLayerViolations([definition, {
      ...consumer,
      manifest: { ...consumer.manifest, peerDependencies: { '@deepseek-ai/dsh-fs': 'workspace:^' } },
    }])).toEqual([])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects a module Consumer that depends on a concrete Provider through %s',
    (section) => {
      expect(collectRuntimeLayerViolations([provider, {
        ...consumer,
        manifest: { ...consumer.manifest, [section]: { '@deepseek-ai/dsh-fs-local': 'workspace:^' } },
      }])).toEqual([
        `@deepseek-ai/dsh-tool-fs: ${section}.@deepseek-ai/dsh-fs-local violates runtime-layer policy: module Consumers may not consume module Providers`,
      ])
    },
  )

  it('rejects Core and Engine dependencies that cross their runtime ownership', () => {
    expect(collectRuntimeLayerViolations([definition, provider, {
      dir: 'rsh/Core/util/example',
      manifest: { name: '@deepseek-ai/dsh-core-example', dependencies: { '@deepseek-ai/dsh-fs': 'workspace:^' } },
    }, {
      dir: 'rsh/Engine/core/example',
      manifest: { name: '@deepseek-ai/dsh-engine-example', dependencies: { '@deepseek-ai/dsh-fs-local': 'workspace:^' } },
    }])).toEqual([
      '@deepseek-ai/dsh-core-example: dependencies.@deepseek-ai/dsh-fs violates runtime-layer policy: Core packages may not consume Engine, module, compatibility, or Program packages',
      '@deepseek-ai/dsh-engine-example: dependencies.@deepseek-ai/dsh-fs-local violates runtime-layer policy: Engine packages may not consume module Providers',
    ])
  })

  it('rejects a renewed Codex dependency on the Program-owned SDK protocol', () => {
    expect(collectRuntimeLayerViolations([{
      dir: 'rsh/Programs/SDK/packages/protocol',
      manifest: { name: '@deepseek-ai/dsh-sdk-protocol' },
    }, {
      dir: 'rsh/Engine/subagent/subagent-codex',
      manifest: {
        name: '@deepseek-ai/dsh-subagent-codex',
        dependencies: { '@deepseek-ai/dsh-sdk-protocol': 'workspace:^' },
      },
    }])).toEqual([
      '@deepseek-ai/dsh-subagent-codex: dependencies.@deepseek-ai/dsh-sdk-protocol violates runtime-layer policy: Engine packages may not consume Program packages',
    ])
  })

  it('rejects malformed runtime metadata', () => {
    expect(collectRuntimeLayerViolations([{
      dir: 'rsh/Modules/Official/fs/example',
      manifest: {
        name: '@deepseek-ai/dsh-fs-example',
        dsh: { runtime: { apiVersion: 2, role: 'unknown', capability: ' ' } },
      },
    }])).toEqual([
      '@deepseek-ai/dsh-fs-example: dsh.runtime must declare apiVersion 1, a supported role, and a non-blank capability',
    ])
  })
})
describe('dsh family version coherence', () => {

  it('rejects a package carrying a stale shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@deepseek-ai/dsh-http-proxy', version: '0.1.2-alpha.5' },
      '0.1.2-rc.1',
    )).toBe('@deepseek-ai/dsh-http-proxy: package.json version must match root version 0.1.2-rc.1')
  })

  it('rejects the root-named CLI app on a stale shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@deepseek-ai/dsh', version: '0.1.2-alpha.5' },
      '0.1.2-rc.1',
    )).toBe('@deepseek-ai/dsh: package.json version must match root version 0.1.2-rc.1')
  })

  it('accepts a manifest carrying the shared version', () => {
    expect(checkDshFamilyVersion(
      { name: '@deepseek-ai/dsh-http-proxy', version: '0.1.2-rc.1' },
      '0.1.2-rc.1',
    )).toBeUndefined()
  })

  it('leaves other sequences to their own version lines', () => {
    expect(checkDshFamilyVersion({ name: '@deepseek-ai/cordis', version: '4.0.1' }, '0.1.2-rc.1')).toBeUndefined()
    expect(checkDshFamilyVersion(
      { name: '@deepseek-ai/node-addon-system', version: '0.1.1' },
      '0.1.2-rc.1',
    )).toBeUndefined()
    expect(checkDshFamilyVersion({ version: '0.1.2-alpha.5' }, '0.1.2-rc.1')).toBeUndefined()
  })
})

describe('Cordis peer classification', () => {
  it('requires Cordis for compatibility-only packages', () => {
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Engine/core/agent-loop',
      manifest: {
        name: '@deepseek-ai/dsh-agent-loop',
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Engine/core/agent-loop',
      manifest: {
        name: '@deepseek-ai/dsh-agent-loop',
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
        devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      },
    })).toContain('@deepseek-ai/dsh-agent-loop: compatibility package must keep the Cordis peer required')
  })

  it('permits Cordis-free strict native packages', () => {
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Engine/core/native-agent',
      manifest: { name: '@deepseek-ai/dsh-native-agent' },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Engine/core/native-agent',
      manifest: {
        name: '@deepseek-ai/dsh-native-agent',
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      },
    })).toContain('@deepseek-ai/dsh-native-agent: native runtime must not declare Cordis dependencies')
  })

  it('classifies the TypeScript SDK client as a Cordis-free native package', () => {
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Programs/SDK/packages/client',
      manifest: {
        name: '@deepseek-ai/dsh-sdk-client',
        dependencies: { '@deepseek-ai/dsh': 'workspace:*' },
        peerDependencies: {
          '@deepseek-ai/dsh-llm': 'workspace:^',
          '@deepseek-ai/dsh-sdk-protocol': 'workspace:^',
          '@deepseek-ai/dsh-session': 'workspace:^',
        },
        devDependencies: {
          '@deepseek-ai/dsh-llm': 'workspace:^',
          '@deepseek-ai/dsh-sdk-protocol': 'workspace:^',
          '@deepseek-ai/dsh-session': 'workspace:^',
        },
      },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Programs/SDK/packages/client',
      manifest: {
        name: '@deepseek-ai/dsh-sdk-client',
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      },
    })).toContain('@deepseek-ai/dsh-sdk-client: native runtime must not declare Cordis dependencies')
  })

  it('requires optional Cordis peers for mixed native packages', () => {
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Modules/Official/fs/fs-local',
      manifest: {
        name: '@deepseek-ai/dsh-fs-local',
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
        devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Programs/Web/client/web',
      manifest: {
        name: '@deepseek-ai/dsh-client-web',
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
        devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      },
    })).toEqual([])
    expect(checkCordisPeerPolicy({
      dir: 'rsh/Modules/Official/fs/fs-local',
      manifest: {
        name: '@deepseek-ai/dsh-fs-local',
        peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
      },
    })).toContain('@deepseek-ai/dsh-fs-local: mixed native package must mark the Cordis peer as optional')
  })
})

describe('package payload constraints', () => {
  it('includes a runtime adapter exported as a separate bundle', () => {
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-runtime',
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
    expect(expectedDshPackageFiles({
      name: '@deepseek-ai/dsh-private-runtime-definition',
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
    ['@deepseek-ai/dsh-credentials', ['lib/native.js', 'lib/shared-*.js']],
    ['@deepseek-ai/dsh-credentials-local', ['lib/native.js', 'lib/backend.js', 'lib/shared-*.js']],
    ['@deepseek-ai/dsh-settings', ['lib/native.js', 'lib/shared-*.js']],
    ['@deepseek-ai/dsh-launch-environment', ['lib/native.js', 'lib/layers.js', 'lib/shared-*.js']],
    ['@deepseek-ai/dsh-tool-subagent', ['lib/model-selection-settings.js', 'lib/native.js', 'lib/shared-*.js']],
    ['@deepseek-ai/dsh-client-native-application', ['lib/native.js', 'lib/controller.js', 'lib/native-*.js']],
  ] as const)('includes native entry dependencies for %s', (name, extras) => {
    expect(expectedDshPackageFiles({ name })).toEqual([
      'lib/index.js',
      ...extras,
      'lib/types/**/*.d.ts',
    ])
  })

  it('includes the separately published Todo Client entry', () => {
    expect(expectedDshPackageFiles({ name: '@deepseek-ai/dsh-tool-todo' })).toContain('lib/client-native.js')
  })

  it('includes the Cordis-free sandbox native entries and shared chunks in the package', () => {
    expect(expectedDshPackageFiles({ name: '@deepseek-ai/dsh-sandbox' })).toEqual([
      'lib/index.js', 'lib/native-types.js', 'lib/native.js', 'lib/shared-*.js', 'lib/types/**/*.d.ts',
    ])
  })
})
