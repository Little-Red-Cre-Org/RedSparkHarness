/** Baseline package discovery never publishes or changes the fixture manifests. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkspacePackageSet } from './publish-npm-baseline.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('discovers migrated harness packages and independently versioned vendor packages', () => {
  const root = mkdtempSync(join(tmpdir(), 'rsh-baseline-discovery-'))
  roots.push(root)
  const manifests = [
    ['package.json', '@redspark/rsh-root', '1.0.0'],
    ['rsh/Core/vendor/cordis/package.json', '@redspark/cordis', '4.0.0'],
    ['rsh/Engine/core/agent/package.json', '@redspark/rsh-agent', '1.0.0'],
    ['rsh/Modules/Official/shell/tool/package.json', '@redspark/rsh-tool', '1.0.0'],
    ['rsh/Programs/Web/application/package.json', '@redspark/rsh-web-frontend', '1.0.0'],
    ['rsh/Core/native/system/package.json', '@redspark/node-addon-system-workspace', '0.1.2'],
  ] as const
  for (const [path, name, version] of manifests) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, `${JSON.stringify({ name, version })}\n`)
  }
  const discovered = WorkspacePackageSet.discover(root)
  expect(discovered.baseVersion).toBe('1.0.0')
  expect(discovered.packages.map(({ name, origin }) => ({ name, origin }))).toEqual([
    { name: '@redspark/cordis', origin: 'vendor' },
    { name: '@redspark/rsh-agent', origin: 'harness' },
    { name: '@redspark/rsh-tool', origin: 'harness' },
    { name: '@redspark/rsh-web-frontend', origin: 'harness' },
  ])
})
