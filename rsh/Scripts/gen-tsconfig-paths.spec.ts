import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectNativeEntryAliases,
  collectPackageAliases,
  collectPackageNames,
  collectNativeExportAliases,
  mappedPathAliases,
  mappedSpecifiers,
  renderAliases,
  uncoveredPackages,
  uncoveredNativeAliases,
  writeRegion,
} from './gen-tsconfig-paths.ts'

const root = resolve(import.meta.dirname, '..', '..')

describe('generated tsconfig package aliases', () => {
  it('maps each package to its own source directory', () => {
    const aliases = collectPackageAliases()
    expect(aliases.length).toBeGreaterThan(100)
    const session = aliases.find(alias => alias.specifier === '@redspark/rsh-session')
    expect(session).toEqual({
      specifier: '@redspark/rsh-session',
      source: './rsh/Engine/core/session/src',
      hasInvariant: true,
    })
    // Sorted, so a package added anywhere lands in a stable spot in the diff.
    expect([...aliases].sort((a, b) => a.specifier.localeCompare(b.specifier))).toEqual(aliases)
    // Only packages named after their directory: the rest carry hand-written
    // aliases, because the removed wildcards could never have resolved them.
    expect(aliases.some(alias => alias.specifier === '@redspark/rsh-typert-protocol')).toBe(false)
  })

  it('maps declared native exports to declaration source files', () => {
    const aliases = collectNativeEntryAliases()
    expect(aliases).toContainEqual({
      specifier: '@redspark/rsh-credentials/native',
      source: './rsh/Modules/Official/credentials/credentials/src/native.ts',
    })
    expect(aliases).toContainEqual({
      specifier: '@redspark/rsh-launch-environment/native',
      source: './rsh/Core/util/launch-environment/src/native.ts',
    })
    expect(aliases).toContainEqual({
      specifier: '@redspark/rsh-native-prompt/native',
      source: './rsh/Engine/core/native-prompt/src/index.ts',
    })
    expect(aliases).toContainEqual({
      specifier: '@redspark/rsh-native-sandbox-policy/native',
      source: './rsh/Modules/Official/sandbox/native-sandbox-policy/src/index.ts',
    })
  })

  it.each([
    {
      specifier: '@redspark/rsh-client-ui-trajectory/native',
      source: './rsh/Programs/Web/client/ui-trajectory/src/native.tsx',
    },
  ])('maps TSX native export $specifier to its source file', ({ specifier, source }) => {
    expect(collectNativeEntryAliases()).toContainEqual({ specifier, source })
  })

  it('yields to a hand-written alias and closes without a trailing comma', () => {
    const aliases = [
      { specifier: '@redspark/rsh-a', source: './packages/g/a/src', hasInvariant: true },
      { specifier: '@redspark/rsh-b', source: './packages/g/b/src', hasInvariant: false },
    ]
    const body = renderAliases(aliases, new Set(['@redspark/rsh-a']))

    // The hand-written bare alias is skipped; its /invariant sibling is not.
    expect(body).toBe([
      '      "@redspark/rsh-a/invariant": ["./packages/g/a/src/invariant.ts"]',
      '      "@redspark/rsh-b": ["./packages/g/b/src"]',
    ].join(',\n'))
    expect(body.endsWith(',')).toBe(false)
  })

  it('renders native aliases into the generated region', () => {
    const body = renderAliases([], new Set(), [
      { specifier: '@redspark/rsh-example/native', source: './rsh/Engine/example/src/native.ts' },
    ])
    expect(body).toBe(
      '      "@redspark/rsh-example/native": ["./rsh/Engine/example/src/native.ts"]',
    )
  })

  it('replaces only the marked region', () => {
    const text = [
      '{ "before": 1,',
      '      // BEGIN generated package aliases — pnpm run gen-tsconfig-paths',
      '      "stale": ["gone"]',
      '      // END generated package aliases',
      '  "after": 2 }',
    ].join('\n')

    const next = writeRegion(text, '      "fresh": ["kept"]')

    expect(next).toContain('{ "before": 1,')
    expect(next).toContain('  "after": 2 }')
    expect(next).toContain('"fresh": ["kept"]')
    expect(next).not.toContain('stale')
  })

  it('refuses a config without the region markers', () => {
    expect(() => writeRegion('{}', '')).toThrow('missing the generated-region markers')
  })

  it('names a package that no alias covers', () => {
    // Deleting the group wildcards removed the fallback that used to resolve a
    // package nobody had aliased. A package whose name does not match its
    // directory is skipped by the generator, so without this check it would
    // resolve through the workspace symlink to built lib/types instead.
    expect(uncoveredPackages(
      ['@redspark/rsh-a', '@redspark/rsh-b'],
      new Set(['@redspark/rsh-a', '@redspark/rsh-a/invariant']),
    )).toEqual(['@redspark/rsh-b'])

    expect(uncoveredPackages(['@redspark/rsh-a'], new Set(['@redspark/rsh-a']))).toEqual([])
  })

  it('covers every workspace package in the committed config', () => {
    const config = readFileSync(resolve(root, 'tsconfig.base.json'), 'utf8')
    // Includes the packages the generator skips because their name does not
    // match their directory: those carry hand-written aliases.
    const names = collectPackageNames()
    expect(names).toContain('@redspark/rsh-typert-protocol')
    expect(uncoveredPackages(names, mappedSpecifiers(config))).toEqual([])
  })

  it('maps every native package export to its source in the shared resolution config', () => {
    const config = readFileSync(resolve(root, 'tsconfig.base.json'), 'utf8')
    const nativeAliases = collectNativeExportAliases(root)
    expect(nativeAliases.size).toBeGreaterThan(20)
    expect(nativeAliases.has('@redspark/rsh-native-sdk-server/native')).toBe(true)
    expect(uncoveredNativeAliases(nativeAliases, mappedPathAliases(config))).toEqual([])
    expect(uncoveredNativeAliases(
      new Map([['@redspark/rsh-native-probe/native', './rsh/Engine/probe/src']]),
      new Map([['@redspark/rsh-native-probe/native', './rsh/Engine/probe/lib/native.js']]),
    )).toEqual([
      '@redspark/rsh-native-probe/native -> source under ./rsh/Engine/probe/src (found ./rsh/Engine/probe/lib/native.js)',
    ])
  })

  it('ignores nested deployment manifests but rejects workspace native exports without source', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-native-export-alias-'))
    const workspaceDir = join(fixtureRoot, 'rsh/Programs/SDK/packages/native-probe')
    const artifactDir = join(
      fixtureRoot,
      'rsh/Programs/SDK/python/sdk-runtime/src/deepseek_harness_runtime/runtime/node/node_modules/@redspark/rsh-agent-instructions',
    )
    try {
      mkdirSync(join(workspaceDir, 'src'), { recursive: true })
      writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({
        name: '@redspark/rsh-native-probe',
        exports: { './native': { types: './lib/types/native.d.ts', default: './lib/native.js' } },
      }))
      mkdirSync(artifactDir, { recursive: true })
      writeFileSync(join(artifactDir, 'package.json'), JSON.stringify({
        name: '@redspark/rsh-agent-instructions',
        exports: { './native': { types: './lib/types/native.d.ts', default: './lib/native.js' } },
      }))

      expect([...collectNativeExportAliases(fixtureRoot)]).toEqual([
        ['@redspark/rsh-native-probe/native', './rsh/Programs/SDK/packages/native-probe/src'],
      ])

      rmSync(join(workspaceDir, 'src'), { recursive: true })
      expect(() => collectNativeExportAliases(fixtureRoot)).toThrow(
        /native-probe[\\/]package\.json has no src directory/,
      )
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('leaves no wildcard that probes every package group', () => {
    const config = readFileSync(resolve(root, 'tsconfig.base.json'), 'utf8')
    // These two listed one candidate per group, so resolving a package late in
    // the list cost a filesystem probe — and under tsx a decorated module
    // error — for every group before it.
    expect(config).not.toContain('"@redspark/rsh-*":')
    expect(config).not.toContain('"@redspark/rsh-*/invariant":')
  })
})
