/**
 * The verify-cordis-config metadata contract: `disabled` is the one entry
 * metadata field whose `!!js` expression the Loader interpolates; every other
 * metadata field must stay static, and a disabled expression must parse.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bundleManifestPaths,
  bundlePluginDependencyErrors,
  cliPluginDependencyErrors,
  metadataExpressionErrors,
  packageTestFixtureDependencyErrors,
  packageTestPluginDependencyErrors,
} from './verify-cordis-config.ts'

describe('verify-cordis-config metadata expressions', () => {
  it('accepts a disabled !!js expression', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: '@redspark/rsh-tool-bash', disabled: { __jsExpr: "process.platform === 'win32'" } },
      '[0]',
    )
    expect(problems).toEqual([])
  })

  it('rejects an expression in a static metadata field', () => {
    const problems = metadataExpressionErrors({ id: { __jsExpr: 'process.platform' }, name: 'pkg' }, '[0]')
    expect(problems).toContain('[0].id: !!js is not interpolated here')
  })

  it('rejects an expression nested below disabled (only the field itself interpolates)', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: 'pkg', disabled: { when: { __jsExpr: 'process.platform' } } },
      '[0]',
    )
    expect(problems).toContain('[0].disabled.when: !!js is not interpolated here')
  })

  it('rejects a disabled expression that does not parse (the loader would fail the boot)', () => {
    const problems = metadataExpressionErrors(
      { id: 'tool-bash', name: 'pkg', disabled: { __jsExpr: 'process.platform ===' } },
      '[0]',
    )
    expect(problems.some(problem => problem.includes('[0].disabled: disabled expression does not parse'))).toBe(true)
  })
})

describe('workspace Bundle discovery and product dependency closures', () => {
  it('discovers a Bundle outside rsh/Compatibility/DSH/bundle from its manifest declaration', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-bundle-discovery-'))
    try {
      const bundleDir = join(fixture, 'rsh/Engine/subagent/example')
      const plainDir = join(fixture, 'rsh/Compatibility/DSH/bundle/plain')
      mkdirSync(bundleDir, { recursive: true })
      mkdirSync(plainDir, { recursive: true })
      writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
        name: '@redspark/rsh-subagent-example',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
      writeFileSync(join(plainDir, 'package.json'), JSON.stringify({
        name: '@redspark/rsh-plain',
      }))

      expect(bundleManifestPaths(fixture)).toEqual([
        'rsh/Engine/subagent/example/package.json',
      ])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('allows a Bundle to mount itself but rejects an undeclared plugin package', () => {
    const manifestPath = 'rsh/Engine/subagent/example/package.json'
    const file = 'rsh/Engine/subagent/example/cordis.patch.yml'
    const manifest = {
      name: '@redspark/rsh-subagent-example',
      dependencies: {},
    }
    const self = { file, name: '@redspark/rsh-subagent-example' }
    expect(bundlePluginDependencyErrors(manifestPath, manifest, [self])).toEqual([])
    expect(bundlePluginDependencyErrors(manifestPath, manifest, [
      self,
      { file, name: '@redspark/rsh-missing-plugin' },
    ])).toEqual([
      `${file}: @redspark/rsh-missing-plugin must be declared in ${manifestPath} dependencies`,
    ])
  })
})

describe('CLI optional compatibility dependencies', () => {
  it('accepts configured plugins from optional dependencies and rejects absent ones', () => {
    const file = 'rsh/Programs/CLI/config/default/cordis.yml'
    const manifest = {
      dependencies: { '@redspark/rsh-native-runtime': 'workspace:^' },
      optionalDependencies: { '@redspark/rsh-hooks-codex': 'workspace:^' },
    }
    expect(cliPluginDependencyErrors([
      { file, name: '@redspark/rsh-hooks-codex' },
    ], manifest)).toEqual([])
    expect(cliPluginDependencyErrors([
      { file, name: '@redspark/rsh-missing' },
    ], manifest)).toEqual([
      `${file}: @redspark/rsh-missing must be declared in `
      + 'rsh/Programs/CLI/package.json dependencies or optionalDependencies',
    ])
  })

  it('accepts optional and development plugins in test-only compatibility fixtures', () => {
    const file = 'rsh/Programs/CLI/tests/fixtures/cordis.yml'
    expect(cliPluginDependencyErrors([
      { file, name: '@redspark/rsh-hooks-codex' },
      { file, name: '@redspark/rsh-test-plugin' },
    ], {
      optionalDependencies: { '@redspark/rsh-hooks-codex': 'workspace:^' },
      devDependencies: { '@redspark/rsh-test-plugin': 'workspace:^' },
    }, true)).toEqual([])
  })
})

describe('package-owned Loader test dependency closures', () => {
  it('requires package test configs to declare each named plugin they load', () => {
    const manifestPath = 'rsh/example/owner/package.json'
    const file = 'rsh/example/owner/tests/fixtures/cordis.yml'
    const manifest = {
      name: '@redspark/rsh-owner',
      dependencies: {},
      devDependencies: {
        '@redspark/rsh-declared': 'workspace:^',
      },
    }
    expect(packageTestPluginDependencyErrors(manifestPath, manifest, [
      { file, name: '@redspark/rsh-owner' },
      { file, name: '@redspark/rsh-declared' },
      { file, name: '@redspark/rsh-missing' },
    ])).toEqual([
      `${file}: @redspark/rsh-missing must be declared in ${manifestPath} dependencies, optionalDependencies or devDependencies`,
    ])
  })

  it('requires executable package test fixtures to declare their bare imports', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-package-test-entrypoint-'))
    try {
      const packageDir = join(fixture, 'rsh/example/owner')
      const driverDir = join(packageDir, 'tests/fixtures/loader')
      mkdirSync(driverDir, { recursive: true })
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
        name: '@redspark/rsh-owner',
        devDependencies: {
          '@redspark/rsh-declared': 'workspace:^',
        },
      }))
      writeFileSync(join(driverDir, 'driver.ts'), [
        "import '@redspark/rsh-owner'",
        "import '@redspark/rsh-declared'",
        "import '@redspark/rsh-missing'",
      ].join('\n'))
      writeFileSync(join(driverDir, 'cordis.yml'), '[]\n')
      writeFileSync(join(driverDir, 'fixture.mjs'), "import '@redspark/rsh-declared'\n")
      const unrelatedDir = join(packageDir, 'tests/fixtures/unrelated')
      mkdirSync(unrelatedDir, { recursive: true })
      writeFileSync(join(unrelatedDir, 'driver.ts'), "import '@redspark/rsh-unrelated'\n")

      expect(packageTestFixtureDependencyErrors(fixture)).toEqual([
        'rsh/example/owner/tests/fixtures/loader/driver.ts: '
        + '@redspark/rsh-missing must be declared in '
        + 'rsh/example/owner/package.json dependencies, optionalDependencies or devDependencies',
      ])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('fails loud when package-owned Loader fixtures disappear from the scan', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-empty-package-test-entrypoint-'))
    try {
      expect(packageTestFixtureDependencyErrors(fixture)).toEqual([
        'package test fixture dependency scan found no package-owned Loader configs',
      ])
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
