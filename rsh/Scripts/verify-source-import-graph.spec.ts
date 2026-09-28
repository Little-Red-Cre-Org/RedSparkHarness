import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectCordisSourceUses,
  collectSourceImportReferences,
  sourceImportViolations,
  type ResolvedSourceImportEdge,
  type SourceImportOwner,
} from './verify-source-import-graph.ts'

const roots: string[] = []
const owner = (name: string, directory: string, deps: Record<string, string> = {}): SourceImportOwner => ({
  name,
  directory,
  dependencies: deps,
  optionalDependencies: {},
  peerDependencies: {},
  devDependencies: {},
})

function fixture(importText: string, options: ts.CompilerOptions = {}): {
  source: ts.SourceFile
  importer: SourceImportOwner
  target: SourceImportOwner
  owners: SourceImportOwner[]
  options: ts.CompilerOptions
} {
  const root = mkdtempSync(join(tmpdir(), 'rsh-source-graph-'))
  roots.push(root)
  const importerDir = join(root, 'packages', 'importer')
  const targetDir = join(root, 'packages', 'target')
  mkdirSync(join(importerDir, 'src'), { recursive: true })
  mkdirSync(join(targetDir, 'src'), { recursive: true })
  const fileName = join(importerDir, 'src', 'index.ts')
  const targetFile = join(targetDir, 'src', 'index.ts')
  writeFileSync(fileName, importText)
  writeFileSync(targetFile, 'export const value = 1\n')
  const importer = owner('@test/importer', importerDir)
  const target = owner('@test/target', targetDir)
  return {
    source: ts.createSourceFile(fileName, importText, ts.ScriptTarget.Latest, true),
    importer,
    target,
    owners: [importer, target],
    options: { moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, ...options },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('verify-source-import-graph', () => {
  it('collects runtime, type, re-export, augmentation, and literal loader edges', () => {
    const code = [
      "import type { T } from '@test/target'",
      "export { value } from '../target/src/index.ts'",
      "import '../target/src/index.ts'",
      "import('../target/src/index.ts')",
      "require('../target/src/index.ts')",
      "declare module '@test/target' {}",
    ].join('\n')
    const refs = collectSourceImportReferences(ts.createSourceFile('fixture.ts', code, ts.ScriptTarget.Latest, true))
    expect(refs.map(ref => [ref.specifier, ref.kind, ref.computed])).toEqual([
      ['@test/target', 'type', false],
      ['../target/src/index.ts', 'runtime', false],
      ['../target/src/index.ts', 'runtime', false],
      ['../target/src/index.ts', 'runtime', false],
      ['../target/src/index.ts', 'runtime', false],
      ['@test/target', 'type', false],
    ])
    const cordis = ts.createSourceFile(
      'cordis.ts',
      "import { Context, type Fiber } from '@deepseek-ai/cordis'\n",
      ts.ScriptTarget.Latest,
      true,
    )
    expect(collectCordisSourceUses(cordis, '@test/owner', 'host')).toMatchObject([{
      owner: '@test/owner',
      face: 'host',
      specifier: '@deepseek-ai/cordis',
      kind: 'runtime',
      symbols: ['value:Context', 'type:Fiber'],
    }])
  })

  it('detects undeclared relative cross-package and re-export edges', () => {
    const f = fixture("export { value } from '../../target/src/index.ts'\n")
    expect(sourceImportViolations(f.source, f.importer, f.owners, f.options, 'host'))
      .toEqual(expect.arrayContaining([expect.stringContaining('runtime edge @test/importer -> @test/target')]))
  })

  it('resolves TypeScript aliases to their actual workspace owner', () => {
    const f = fixture("import { value } from '@test/target'\n")
    const importerDir = f.importer.directory
    const root = resolve(importerDir, '../..')
    f.options.paths = { '@test/*': ['packages/*/src/index.ts'] }
    f.options.baseUrl = root
    const edges: ResolvedSourceImportEdge[] = []
    expect(sourceImportViolations(f.source, f.importer, f.owners, f.options, 'client', new Set(), undefined, edges))
      .toEqual(expect.arrayContaining([expect.stringContaining('runtime edge @test/importer -> @test/target')]))
    expect(edges).toEqual([expect.objectContaining({ targetOwner: '@test/target' })])
    expect(edges[0]?.resolvedWorkspacePath).toContain('packages')
  })

  it('uses Host and Client resolution options independently', () => {
    const f = fixture("import { value } from '@test/target'\n")
    const otherDir = join(resolve(f.importer.directory, '../..'), 'packages', 'other')
    mkdirSync(join(otherDir, 'src'), { recursive: true })
    writeFileSync(join(otherDir, 'src', 'index.ts'), 'export const value = 2\n')
    const other = owner('@test/other', otherDir)
    const importer = { ...f.importer, dependencies: { '@test/target': 'workspace:^' } }
    const owners = [importer, f.target, other]
    const root = resolve(f.importer.directory, '../..')
    const hostOptions = { ...f.options, baseUrl: root, paths: { '@test/target': ['packages/target/src/index.ts'] } }
    const clientOptions = { ...f.options, baseUrl: root, paths: { '@test/target': ['packages/other/src/index.ts'] } }
    expect(sourceImportViolations(f.source, importer, owners, hostOptions, 'host')).toEqual([])
    expect(sourceImportViolations(f.source, importer, owners, clientOptions, 'client'))
      .toEqual(expect.arrayContaining([expect.stringContaining('client alias "@test/target" resolves to @test/other')]))
  })

  it('distinguishes type-only imports and blocks Cordis through a native alias', () => {
    const f = fixture("import type { T } from '@deepseek-ai/cordis'\n", {
      paths: { '@deepseek-ai/cordis': ['packages/target/src/index.ts'] },
    })
    f.options.baseUrl = resolve(f.importer.directory, '../..')
    const strict = new Set([f.importer.directory.replaceAll('\\', '/').toLowerCase()])
    const problems = sourceImportViolations(f.source, f.importer, f.owners, f.options, 'host', strict)
    expect(problems.some(problem => problem.includes('native source owner @test/importer imports Cordis'))).toBe(true)
    expect(problems.some(problem => problem.includes('type edge'))).toBe(true)
  })

  it('reports computed loaders for governance without inventing a package edge', () => {
    const f = fixture('import(`./${name}.js`)\n')
    expect(collectSourceImportReferences(f.source).some(ref => ref.computed)).toBe(true)
    const edges: ResolvedSourceImportEdge[] = []
    expect(sourceImportViolations(f.source, f.importer, f.owners, f.options, 'host', new Set(), undefined, edges)).toEqual([])
    expect(edges).toEqual([expect.objectContaining({ computed: true })])
    expect(edges[0]?.targetOwner).toBeUndefined()
  })

  it('allows declared dev dependencies and repository tooling only in test sources', () => {
    const f = fixture("import { it } from 'vitest'\n")
    const testSource = ts.createSourceFile(
      join(f.importer.directory, 'tests', 'graph.spec.ts'),
      "import { it } from 'vitest'\n",
      ts.ScriptTarget.Latest,
      true,
    )
    const tooling = owner('root-tools', resolve(f.importer.directory, '../..'), { vitest: 'workspace:^' })
    expect(sourceImportViolations(testSource, f.importer, f.owners, f.options, 'host', new Set(), tooling)).toEqual([])
    expect(sourceImportViolations(f.source, f.importer, f.owners, f.options, 'host', new Set(), tooling))
      .toEqual(expect.arrayContaining([expect.stringContaining('runtime edge @test/importer -> vitest')]))
  })
})
