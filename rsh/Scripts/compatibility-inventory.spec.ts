/** Inventory classification and rejection of missing lifecycle evidence. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectCompatibilityPackageRows, collectLoaderBaseline, type CompatibilityPackageRow } from './compatibility-inventory.ts'
import type { CordisSourceUse } from './verify-source-import-graph.ts'

const roots: string[] = []

function fixture(manifests: readonly { path: string; manifest: object }[]): string {
  const root = mkdtempSync(join(tmpdir(), 'rsh-compatibility-inventory-'))
  roots.push(root)
  for (const item of manifests) {
    const file = join(root, item.path, 'package.json')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(item.manifest)}\n`)
  }
  return root
}

function use(owner: string, fileName: string, line = 1): CordisSourceUse {
  return { owner, fileName, face: 'host', line, specifier: '@deepseek-ai/cordis', kind: 'runtime', symbols: [] }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('compatibility inventory', () => {
  it('keeps production and test Cordis edges separate and classifies native policy owners', () => {
    const root = fixture([
      {
        path: 'rsh/Core/util/atomic-write',
        manifest: { name: '@deepseek-ai/dsh-atomic-write', dependencies: { '@deepseek-ai/dsh-brand': 'workspace:^' } },
      },
      {
        path: 'rsh/Engine/core/session',
        manifest: { name: '@deepseek-ai/dsh-session', dependencies: { '@deepseek-ai/cordis': 'workspace:^' }, devDependencies: { '@deepseek-ai/cordis': 'workspace:^' } },
      },
    ])
    const rows = collectCompatibilityPackageRows(root, [
      use('@deepseek-ai/dsh-session', join(root, 'rsh/Engine/core/session/src/index.ts')),
      use('@deepseek-ai/dsh-session', join(root, 'rsh/Engine/core/session/tests/session.spec.ts'), 2),
    ])
    expect(rows.find(row => row.name === '@deepseek-ai/dsh-atomic-write')).toMatchObject<Partial<CompatibilityPackageRow>>({
      classification: 'native-migrated', nativeExports: ['.'],
    })
    expect(rows.find(row => row.name === '@deepseek-ai/dsh-session')).toMatchObject<Partial<CompatibilityPackageRow>>({
      classification: 'native-mixed', productionCordisUses: 1, testCordisUses: 1,
      cordisDependencies: ['@deepseek-ai/cordis'], cordisDevelopmentDependencies: ['@deepseek-ai/cordis'],
    })
  })

  it('does not report unrelated framework-free packages', () => {
    const root = fixture([{ path: 'rsh/Engine/core/unrelated', manifest: { name: '@test/unrelated' } }])
    expect(collectCompatibilityPackageRows(root, [])).toEqual([])
  })

  it('preserves plugin entries and each Cordis requirement without conflating optional peers', () => {
    const root = fixture([{
      path: 'rsh/Modules/Official/fs/fs-local',
      manifest: {
        name: '@deepseek-ai/dsh-fs-local', version: '0.1.5-rc.2', main: 'lib/index.js',
        peerDependencies: { '@deepseek-ai/cordis': '^4.0.0-rc.7' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
        devDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
        dsh: { runtime: { role: 'provider', capability: 'filesystem' }, native: { entry: './native', targets: ['host'] }, client: { platform: 'web' } },
      },
    }])
    expect(collectCompatibilityPackageRows(root, [])[0]).toMatchObject({
      version: '0.1.5-rc.2', role: 'provider', capability: 'filesystem',
      nativeEntry: './native', nativeTargets: ['host'], legacyMain: 'lib/index.js', clientPlatform: 'web',
      cordisRequirements: [
        { name: '@deepseek-ai/cordis', section: 'peerDependencies', range: '^4.0.0-rc.7', optional: true },
        { name: '@deepseek-ai/cordis', section: 'devDependencies', range: 'workspace:^', optional: false },
      ],
    })
  })

  it('separates compatibility and test owners from packages still requiring migration', () => {
    const manifests = [
      { path: 'rsh/Compatibility/DSH/bridge/example', name: '@test/compat' },
      { path: 'rsh/Tests/test-support/example', name: '@test/fixture' },
      { path: 'rsh/Engine/core/example', name: '@test/engine' },
    ].map(({ path, name }) => ({ path, manifest: { name, dependencies: { '@deepseek-ai/cordis': 'workspace:^' } } }))
    const root = fixture(manifests)
    expect(collectCompatibilityPackageRows(root, []).map(row => [row.name, row.classification])).toEqual([
      ['@test/compat', 'compatibility-retained'], ['@test/engine', 'migration-required'], ['@test/fixture', 'test-tooling'],
    ])
  })

  it('distinguishes a development-only Cordis use from an optional production dependency', () => {
    const root = fixture([
      { path: 'rsh/Engine/core/test-only', manifest: { name: '@test/test-only', devDependencies: { '@deepseek-ai/cordis': 'workspace:^' } } },
      { path: 'rsh/Engine/core/optional', manifest: { name: '@test/optional', optionalDependencies: { '@deepseek-ai/cordis': '^4' } } },
    ])
    const rows = collectCompatibilityPackageRows(root, [use('@test/test-only', join(root, 'rsh/Engine/core/test-only/tests/loader.spec.ts'))])
    expect(rows.find(row => row.name === '@test/test-only')).toMatchObject({ classification: 'framework-free', productionCordisUses: 0, testCordisUses: 1 })
    expect(rows.find(row => row.name === '@test/optional')).toMatchObject({
      classification: 'migration-required',
      cordisRequirements: [{ name: '@deepseek-ai/cordis', section: 'optionalDependencies', range: '^4', optional: true }],
    })
  })

  it('rejects a baseline whose source or test evidence is absent', () => {
    const rows = collectLoaderBaseline(resolve(import.meta.dirname, '../..'))
    const root = fixture([])
    for (const file of new Set(rows.flatMap(row => [...row.evidence, ...row.tests]))) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), '')
    }
    expect(collectLoaderBaseline(root)).toEqual(rows)
    const source = rows[0]!.evidence[0]!
    const regression = rows[0]!.tests[0]!
    rmSync(join(root, source))
    expect(() => collectLoaderBaseline(root)).toThrow(source)
    writeFileSync(join(root, source), '')
    rmSync(join(root, regression))
    expect(() => collectLoaderBaseline(root)).toThrow(regression)
  })
})
