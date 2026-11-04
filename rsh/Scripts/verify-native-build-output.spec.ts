// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { globCovers, relativeImportsOf, rowDefects } from './verify-native-build-output.ts'

const scratch: string[] = []

function packageDir(manifest: Record<string, unknown>, emit: readonly string[] = []): string {
  const directory = mkdtempSync(join(tmpdir(), 'native-build-output-'))
  scratch.push(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest, null, 2))
  for (const file of emit) {
    mkdirSync(join(directory, file, '..'), { recursive: true })
    writeFileSync(join(directory, file), 'export {}\n')
  }
  return directory
}

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const row = { kind: 'client' as const, id: 'demo', plugin: '@redspark/rsh-client-demo' }

describe('globCovers', () => {
  it('matches a flat file with the exact pattern', () => {
    expect(globCovers('lib/native.js', 'lib/native.js')).toBe(true)
  })

  it('treats a two-star segment as zero or more directories', () => {
    expect(globCovers('lib/**/*.css', 'lib/a.css')).toBe(true)
    expect(globCovers('lib/**/*.css', 'lib/client/a.module.css')).toBe(true)
    expect(globCovers('lib/**/*.css', 'lib/a/b/c.css')).toBe(true)
  })

  it('rejects a target the pattern does not name', () => {
    expect(globCovers('lib/**/*.css', 'lib/native.js')).toBe(false)
    expect(globCovers('lib/client.js', 'lib/client.js.map')).toBe(false)
  })
})

describe('rowDefects', () => {
  it('reports a package the workspace does not contain', () => {
    expect(rowDefects(row, undefined)).toEqual([expect.objectContaining({
      kind: 'client', id: 'demo', defect: 'package is not in the workspace',
    })])
  })

  it('reports a manifest that declares no exports map', () => {
    const directory = packageDir({ name: '@redspark/rsh-client-demo' })
    expect(rowDefects(row, directory).map(defect => defect.defect))
      .toEqual(['package.json declares no exports map'])
  })

  it('reports an export with no default target', () => {
    const directory = packageDir({ exports: { './native': { types: './lib/types/native.d.ts' } } })
    expect(rowDefects(row, directory).map(defect => defect.defect))
      .toEqual(['exports["./native"] has no default target'])
  })

  it('reports an advertised target the build never emitted', () => {
    const directory = packageDir({ exports: { './native': { default: './lib/native.js' } } })
    expect(rowDefects(row, directory).map(defect => defect.defect))
      .toEqual([expect.stringContaining('which does not exist on disk')])
  })

  it('reports a target the files list does not publish', () => {
    const directory = packageDir(
      { exports: { './native': { default: './lib/native.js' } }, files: ['lib/client.js'] },
      ['lib/native.js'],
    )
    expect(rowDefects(row, directory).map(defect => defect.defect))
      .toEqual(['exports["./native"] resolves to lib/native.js, which the package "files" list does not include'])
  })

  it('treats a missing files list as publishing nothing', () => {
    const directory = packageDir({ exports: { './native': { default: './lib/native.js' } } }, ['lib/native.js'])
    expect(rowDefects(row, directory).map(defect => defect.defect))
      .toEqual(['exports["./native"] resolves to lib/native.js, which the package "files" list does not include'])
  })

  it('reports a published entry whose relative import the files list omits', () => {
    const directory = packageDir(
      { exports: { './native': { default: './lib/native.js' } }, files: ['lib/native.js'] },
      ['lib/native.js', 'lib/client/A.module.css'],
    )
    writeFileSync(join(directory, 'lib/native.js'), 'import css from "./client/A.module.css"\nexport {}\n')
    expect(rowDefects(row, directory).map(defect => defect.defect)).toEqual([
      'exports["./native"] imports ./client/A.module.css, which the package "files" list does not include',
    ])
  })

  it('reports a relative import the build never emitted', () => {
    const directory = packageDir(
      { exports: { './native': { default: './lib/native.js' } }, files: ['lib/native.js'] },
      ['lib/native.js'],
    )
    writeFileSync(join(directory, 'lib/native.js'), 'import css from "./client/Missing.module.css"\nexport {}\n')
    expect(rowDefects(row, directory).map(defect => defect.defect))
      .toEqual(['exports["./native"] imports ./client/Missing.module.css, which the build did not emit'])
  })

  it('accepts a complete payload that covers the entry and its stylesheet', () => {
    const directory = packageDir(
      { exports: { './native': { default: './lib/native.js' } }, files: ['lib/native.js', 'lib/**/*.css'] },
      ['lib/native.js', 'lib/client/A.module.css'],
    )
    writeFileSync(join(directory, 'lib/native.js'), 'import css from "./client/A.module.css"\nexport {}\n')
    expect(rowDefects(row, directory)).toEqual([])
  })

  it('names the composition kind so a Client defect is distinguishable', () => {
    const directory = packageDir({ exports: {} })
    expect(rowDefects({ ...row, kind: 'installation' }, directory)[0]?.kind).toBe('installation')
    expect(rowDefects(row, directory)[0]?.kind).toBe('client')
  })
})

describe('relativeImportsOf', () => {
  it('lists relative from-imports and skips bare specifiers', () => {
    const directory = packageDir({}, ['lib/native.js'])
    writeFileSync(join(directory, 'lib/native.js'),
      'import { jsx } from "react/jsx-runtime"\nimport css from "./client/A.module.css"\nimport other from "../shared/b.js"\n')
    expect(relativeImportsOf(join(directory, 'lib/native.js')))
      .toEqual(['./client/A.module.css', '../shared/b.js'])
  })

  it('refuses an entry it cannot read instead of reporting no imports', () => {
    expect(() => relativeImportsOf(join(tmpdir(), 'does-not-exist.js')))
      .toThrow(/cannot read the emitted native entry/u)
  })

  it('admits every emitted form and excludes the ones this build never writes', () => {
    const directory = packageDir({}, ['lib/native.js'])
    const entry = join(directory, 'lib/native.js')
    writeFileSync(entry, [
      'import css from "./a.css"',
      'export { x } from "./b.js"',
      'export * from "../c.js"',
      'import "./d.css"',
      'import{a}from"./e.js"',
      'export*from"./f.js"',
    ].join('\n'))
    expect(relativeImportsOf(entry)).toEqual(['./a.css', './b.js', '../c.js', './d.css', './e.js', './f.js'])

    // Dynamic import, single quotes, and require() stay outside the detection
    // boundary; the emitted leaves of this workspace use none of them.
    writeFileSync(entry, [
      'const e = import("./a.css")',
      "import css from './b.css'",
      'const r = require("./c.css")',
    ].join('\n'))
    expect(relativeImportsOf(entry)).toEqual([])
  })
})
