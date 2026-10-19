/** Behaviour of the Python runtime closure prune that removes legacy staged packages. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installedMatching,
  missingStagedNeighbours,
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

  it('removes a nested tree that duplicates the staging root exactly', () => {
    const nodeModules = staging({
      '@scope/cli': {},
      '@scope/nested-owner': {},
      '@scope/stray': { version: '1.0.0', dependencies: { '@scope/peer': '1' } },
      '@scope/peer': {},
    })
    const nested = join(nodeModules, '@scope/nested-owner/node_modules/@scope/stray')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), `${JSON.stringify({
      name: '@scope/stray', version: '1.0.0', dependencies: { '@scope/peer': '1' },
    })}\n`)

    const result = pruneStagedClosure(nodeModules, ['@scope/cli', '@scope/nested-owner', '@scope/stray'], [])

    expect(existsSync(join(nodeModules, '@scope/nested-owner/node_modules'))).toBe(false)
    expect(result.retainedNested).toBeUndefined()
  })

  it('keeps a nested tree whose copy declares another version', () => {
    const nodeModules = staging({
      '@scope/cli': {},
      '@scope/nested-owner': {},
      '@scope/stray': { version: '1.0.0', dependencies: { '@scope/peer': '1' } },
      '@scope/peer': {},
    })
    const nested = join(nodeModules, '@scope/nested-owner/node_modules/@scope/stray')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), `${JSON.stringify({
      name: '@scope/stray', version: '2.0.0', dependencies: { '@scope/peer': '1' },
    })}\n`)

    const result = pruneStagedClosure(nodeModules, ['@scope/cli', '@scope/nested-owner', '@scope/stray'], [])

    expect(existsSync(nested)).toBe(true)
    expect(result.retainedNested).toEqual(['@scope/nested-owner -> @scope/stray'])
  })

  it('treats a different dependency map as a divergence at the same version', () => {
    const nodeModules = staging({
      '@scope/cli': {},
      '@scope/nested-owner': {},
      '@scope/stray': { version: '1.0.0', dependencies: { '@scope/peer': '1' } },
      '@scope/peer': {},
      '@scope/other': {},
    })
    const nested = join(nodeModules, '@scope/nested-owner/node_modules/@scope/stray')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), `${JSON.stringify({
      name: '@scope/stray', version: '1.0.0', dependencies: { '@scope/other': '1' },
    })}\n`)

    const result = pruneStagedClosure(nodeModules, ['@scope/cli', '@scope/nested-owner', '@scope/stray'], [])

    expect(existsSync(nested)).toBe(true)
    expect(result.retainedNested).toEqual(['@scope/nested-owner -> @scope/stray'])
  })

  it('keeps a nested tree whose package has no same-named package in the staging root', () => {
    const nodeModules = staging({
      '@scope/cli': {},
      '@scope/nested-owner': {},
      '@scope/legacy-removed': {},
    })
    const nested = join(nodeModules, '@scope/nested-owner/node_modules/@scope/stray')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), `${JSON.stringify({ name: '@scope/stray', version: '1.0.0' })}\n`)

    const result = pruneStagedClosure(nodeModules, ['@scope/cli', '@scope/nested-owner', '@scope/legacy-removed'], [])

    expect(existsSync(nested)).toBe(true)
    expect(result.retainedNested).toEqual(['@scope/nested-owner -> @scope/stray'])
  })

  it('keeps a nested tree when neither copy declares a version', () => {
    const nodeModules = staging({
      '@scope/cli': {},
      '@scope/nested-owner': {},
      '@scope/stray': {},
    })
    const nested = join(nodeModules, '@scope/nested-owner/node_modules/@scope/stray')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), `${JSON.stringify({ name: '@scope/stray' })}\n`)

    const result = pruneStagedClosure(nodeModules, ['@scope/cli', '@scope/nested-owner', '@scope/stray'], [])

    expect(existsSync(nested)).toBe(true)
    expect(result.retainedNested).toEqual(['@scope/nested-owner -> @scope/stray'])
  })

  it('keeps a nested tree whose divergence sits below its direct child', () => {
    const nodeModules = staging({
      '@scope/cli': {},
      '@scope/nested-owner': {},
      '@scope/stray': { version: '1.0.0' },
      '@scope/deep': { version: '1.0.0' },
    })
    const nested = join(nodeModules, '@scope/nested-owner/node_modules/@scope/stray')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), `${JSON.stringify({ name: '@scope/stray', version: '1.0.0' })}\n`)
    const deeper = join(nested, 'node_modules/@scope/deep')
    mkdirSync(deeper, { recursive: true })
    writeFileSync(join(deeper, 'package.json'), `${JSON.stringify({ name: '@scope/deep', version: '9.9.9' })}\n`)

    const result = pruneStagedClosure(nodeModules, ['@scope/cli', '@scope/nested-owner', '@scope/stray', '@scope/deep'], [])

    expect(existsSync(nested)).toBe(true)
    expect(result.retainedNested).toEqual(['@scope/nested-owner -> @scope/stray/@scope/deep'])
  })

  it('compares dependency maps regardless of key order', () => {
    const nodeModules = staging({
      '@scope/cli': {},
      '@scope/nested-owner': {},
      '@scope/stray': { version: '1.0.0', dependencies: { '@scope/a': '1', '@scope/b': '2' } },
      '@scope/a': {},
      '@scope/b': {},
    })
    const nested = join(nodeModules, '@scope/nested-owner/node_modules/@scope/stray')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'package.json'), `${JSON.stringify({
      name: '@scope/stray', version: '1.0.0', dependencies: { '@scope/b': '2', '@scope/a': '1' },
    })}\n`)

    pruneStagedClosure(nodeModules, ['@scope/cli', '@scope/nested-owner', '@scope/stray'], [])

    expect(existsSync(join(nodeModules, '@scope/nested-owner/node_modules'))).toBe(false)
  })

  it('reports the plan without deleting under dryRun', () => {
    const nodeModules = staging({ '@scope/cli': {}, '@scope/legacy': {} })

    const result = pruneStagedClosure(nodeModules, ['@scope/cli'], [], true)

    expect(result.removed).toEqual(['@scope/legacy'])
    expect(existsSync(join(nodeModules, '@scope/legacy'))).toBe(true)
  })
})

describe('missingStagedNeighbours', () => {
  it('reports a retained package whose optional peer is absent', () => {
    const nodeModules = staging({
      '@scope/presets': { peerDependencies: { '@scope/scope': '1' }, peerDependenciesMeta: { '@scope/scope': { optional: true } } },
    })

    expect(missingStagedNeighbours(nodeModules, [], '@scope/')).toEqual(['@scope/presets -> @scope/scope'])
  })

  it('keeps the same legacy Cordis exemption as the closure walk', () => {
    const nodeModules = staging({
      '@scope/presets': {
        peerDependencies: { '@deepseek-ai/cordis': '1' },
        peerDependenciesMeta: { '@deepseek-ai/cordis': { optional: true } },
      },
    })

    expect(missingStagedNeighbours(nodeModules)).toEqual([])
  })

  it('skips packages the caller excluded and neighbours outside the scope', () => {
    const nodeModules = staging({
      '@deepseek-ai/dsh': { optionalDependencies: { '@deepseek-ai/legacy': '1' } },
      '@scope/presets': { dependencies: { 'third-party-payload': '1' } },
    })

    expect(missingStagedNeighbours(nodeModules, ['@deepseek-ai/dsh'])).toEqual([])
  })
})
