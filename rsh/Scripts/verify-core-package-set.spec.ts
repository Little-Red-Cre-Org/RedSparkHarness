import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { corePackageNames, workspacePackages } from './verify-core-package-set.ts'

const root = join(import.meta.dirname, '..', '..')

describe('desktop core package set', () => {
  it('collects each scoped package name once, in source order', () => {
    const source = [
      "const A = ['@redspark/rsh-base', '@redspark/rsh-headless']",
      "const B = '@redspark/rsh-base'",
    ].join('\n')
    expect(corePackageNames(source)).toEqual(['@redspark/rsh-base', '@redspark/rsh-headless'])
  })

  it('ignores strings that are not scoped harness packages', () => {
    expect(corePackageNames("const X = ['electron', '@other/thing', 'rsh-base']")).toEqual([])
  })

  it('resolves every name the real module lists', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(join(root, 'rsh/Programs/Desktop/src/core-package-set.ts'), 'utf8')
    const packages = workspacePackages(root)
    const names = corePackageNames(source)
    expect(names.length).toBeGreaterThan(20)
    expect(names.filter(name => !packages.has(name))).toEqual([])
  })

  // The gate exists to catch retirements, so it must reject a name no manifest defines.
  it('reports a listed package that no workspace manifest defines', () => {
    const packages = workspacePackages(root)
    const unresolved = corePackageNames("['@redspark/rsh-does-not-exist', '@redspark/rsh-base']")
      .filter(name => !packages.has(name))
    expect(unresolved).toEqual(['@redspark/rsh-does-not-exist'])
  })

  it('never lists the two packages this branch retired', async () => {
    const { readFileSync } = await import('node:fs')
    const names = corePackageNames(readFileSync(join(root, 'rsh/Programs/Desktop/src/core-package-set.ts'), 'utf8'))
    expect(names).not.toContain('@redspark/rsh-time-context')
    expect(names).not.toContain('@redspark/rsh-tmux-context')
  })
})
