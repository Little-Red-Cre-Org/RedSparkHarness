/** Behaviour of the Python runtime closure prune that removes legacy staged packages. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installedMatching,
  pruneStagedClosure,
  readStagedPackages,
  reachableStagedPackages,
} from './python-runtime-closure-prune.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * Create a staging tree with the given installed packages.
 * @param packages - name to manifest mapping; nested dependencies live under `node_modules`.
 * @returns the staging `node_modules` path.
 */
function staging(packages: Record<string, Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-closure-prune-'))
  roots.push(root)
  const nodeModules = join(root, 'node_modules')
  for (const [name, manifest] of Object.entries(packages)) {
    const directory = join(nodeModules, ...name.split('/'))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ name, ...manifest }, null, 2)}\n`)
  }
  return nodeModules
}

describe('reachableStagedPackages', () => {
  it('keeps an optional peer a retained package imports at runtime, but not a legacy Cordis one', () => {
    const nodeModules = staging({
      '@scope/presets': {
        peerDependencies: { '@scope/scope': '1', '@deepseek-ai/cordis': '1' },
        peerDependenciesMeta: { '@scope/scope': { optional: true }, '@deepseek-ai/cordis': { optional: true } },
      },
      '@scope/scope': {},
      '@deepseek-ai/cordis': {},
    })

    const { reachable } = reachableStagedPackages(readStagedPackages(nodeModules), ['@scope/presets'])

    expect(reachable.has('@scope/scope')).toBe(true)
    expect(reachable.has('@deepseek-ai/cordis')).toBe(false)
  })

  it('does not follow optionalDependencies of a leaf package', () => {
    const nodeModules = staging({
      '@scope/cli': { optionalDependencies: { '@scope/legacy': '1' } },
      '@scope/legacy': {},
    })

    const { reachable } = reachableStagedPackages(readStagedPackages(nodeModules), ['@scope/cli'], ['@scope/cli'])

    expect([...reachable]).toEqual(['@scope/cli'])
  })

  it('follows optionalDependencies of a non-leaf package', () => {
    const nodeModules = staging({
      '@scope/cli': { optionalDependencies: { '@scope/payload': '1' } },
      '@scope/payload': {},
    })

    const { reachable } = reachableStagedPackages(readStagedPackages(nodeModules), ['@scope/cli'])

    expect([...reachable].sort()).toEqual(['@scope/cli', '@scope/payload'])
  })

  it('reports declared names that are not installed', () => {
    const nodeModules = staging({ '@scope/root': {} })

    const { unresolved } = reachableStagedPackages(readStagedPackages(nodeModules), ['@scope/root', '@scope/missing'])

    expect(unresolved).toEqual(['@scope/missing'])
  })
})

describe('pruneStagedClosure', () => {
  it('deletes packages outside the closure and keeps retained ones', () => {
    const nodeModules = staging({
      '@scope/cli': { dependencies: { '@scope/kept': '1' }, optionalDependencies: { '@scope/legacy': '1' } },
      '@scope/kept': {},
      '@scope/legacy': {},
    })

    const result = pruneStagedClosure(nodeModules, ['@scope/cli'], ['@scope/cli'])

    expect(result.removed).toEqual(['@scope/legacy'])
    expect(existsSync(join(nodeModules, '@scope/legacy'))).toBe(false)
    expect(existsSync(join(nodeModules, '@scope/kept'))).toBe(true)
    expect(installedMatching(nodeModules, /@scope\//u)).toEqual(['@scope/cli', '@scope/kept'])
  })

  it('removes nested node_modules trees of retained packages', () => {
    const nodeModules = staging({
      '@scope/cli': {},
      '@scope/nested-owner': {},
      '@scope/legacy-removed': {},
    })
    const nested = join(nodeModules, '@scope/nested-owner/node_modules/@scope/stray')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), `${JSON.stringify({ name: '@scope/stray' })}\n`)

    pruneStagedClosure(nodeModules, ['@scope/cli', '@scope/nested-owner', '@scope/legacy-removed'], [])

    expect(existsSync(join(nodeModules, '@scope/nested-owner/node_modules'))).toBe(false)
  })

  it('reports the plan without deleting under dryRun', () => {
    const nodeModules = staging({ '@scope/cli': {}, '@scope/legacy': {} })

    const result = pruneStagedClosure(nodeModules, ['@scope/cli'], [], true)

    expect(result.removed).toEqual(['@scope/legacy'])
    expect(existsSync(join(nodeModules, '@scope/legacy'))).toBe(true)
  })
})
