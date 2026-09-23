/** Syntax forms that must not escape native dependency ownership checks. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import ts from 'typescript'
import { mixedNativeEntryDirectories, mixedNativeLibraryDirectories, nativePackageDirectories, transitionalNativeSourceDirectories } from './native-package-policy.ts'
import { collectNativeDependencyViolations, nativeSourceViolations } from './verify-native-dependencies.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(content: string, dependency?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'rsh-native-policy-'))
  roots.push(root)
  const write = (path: string, value: string) => {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, value)
  }
  const dir = 'rsh/Core/runtime-diagnostics/native-runtime'
  for (const owner of new Set([...nativePackageDirectories, ...transitionalNativeSourceDirectories])) {
    if (owner === dir) continue
    write(`${owner}/package.json`, JSON.stringify({ name: `@deepseek-ai/dsh-${owner.split('/').at(-1)}` }))
    write(`${owner}/src/index.ts`, 'export {}')
  }
  write(`${dir}/package.json`, JSON.stringify({
    name: '@deepseek-ai/dsh-native-runtime',
    ...(dependency === undefined ? {} : { peerDependencies: { [dependency]: '*' } }),
  }))
  write(`${dir}/src/index.ts`, content)
  write(`${dir}/src/local.ts`, 'export interface Local {}')
  write('rsh/Core/vendor/cordis/src/index.ts', 'export interface Context {}')
  write('rsh/Programs/SDK/packages/protocol/src/index.ts', 'export interface Protocol {}')
  write('tsconfig.host.json', JSON.stringify({
    compilerOptions: {
      noLib: true, moduleResolution: 'bundler', module: 'esnext',
      paths: {
        'hidden-framework': ['./rsh/Core/vendor/cordis/src/index.ts'],
        'hidden-program': ['./rsh/Programs/SDK/packages/protocol/src/index.ts'],
        'hidden-engine': ['./rsh/Engine/core/native-agent/src/index.ts'],
      },
    },
    include: [...new Set([
      ...nativePackageDirectories,
      ...transitionalNativeSourceDirectories,
      ...mixedNativeEntryDirectories.keys(),
      ...mixedNativeLibraryDirectories.keys(),
    ])]
      .map(owner => `${owner}/src/**/*.ts`),
  }))
  write('client.ts', 'export {}')
  write('tsconfig.client.json', JSON.stringify({
    compilerOptions: { noLib: true },
    include: ['client.ts', ...[...mixedNativeLibraryDirectories.keys()].map(owner => `${owner}/src/**/*.ts`)],
  }))
  return root
}

it.each([
  'import "@deepseek-ai/cordis"',
  'import type { Context } from "@deepseek-ai/cordis"',
  'export { Context } from "@deepseek-ai/cordis"',
  'export type { Context } from "@deepseek-ai/cordis"',
  'type C = import("@deepseek-ai/cordis").Context',
  'declare module "@deepseek-ai/cordis" {}',
  'const c = import("@deepseek-ai/cordis")',
  'const c = require("@deepseek-ai/cordis")',
  'import c = require("@deepseek-ai/cordis")',
  'import "alias-to-cordis"',
  'import "../../vendor/cordis/src/index.ts"',
  'const c = import(target)',
  'const c = require(target)',
])('rejects a forbidden or unresolvable production edge: %s', (content) => {
  const source = ts.createSourceFile('entry.ts', content, ts.ScriptTarget.Latest, true)
  expect(nativeSourceViolations(source, () => false)).toHaveLength(1)
})

it('allows resolved native owners without scanning comments or ordinary string data', () => {
  const source = ts.createSourceFile('entry.ts', `
    import { NativeScope } from './scope.ts'
    export type { Disposer } from './scope.ts'
    // import '@deepseek-ai/cordis'
    const label = '@deepseek-ai/cordis'
  `, ts.ScriptTarget.Latest, true)
  expect(nativeSourceViolations(source, specifier => specifier === './scope.ts')).toEqual([])
})

it.each([
  'import type { Context } from "hidden-framework"',
  'export type { Context } from "../../../vendor/cordis/src/index.ts"',
  'export type { Context } from "missing-workspace-package"',
])('resolves actual aliases and refuses non-native or missing owners: %s', (content) => {
  expect(collectNativeDependencyViolations(fixture(content)).some(error => error.includes('cannot reference'))).toBe(true)
})

it('admits a local native source edge and rejects forbidden manifest peers', () => {
  expect(collectNativeDependencyViolations(fixture('export type { Local } from "./local.ts"'))).toEqual([])
  expect(collectNativeDependencyViolations(fixture('export {}', '@deepseek-ai/cordis'))).toContainEqual(
    expect.stringContaining('peerDependencies.@deepseek-ai/cordis'),
  )
})

it.each([
  ['rsh/Engine/core/native-agent', 'import type { Context } from "hidden-framework"'],
  ['rsh/Engine/core/native-agent', 'export type { Protocol } from "hidden-program"'],
  ['rsh/Engine/core/native-agent', 'type C = import("@deepseek-ai/cordis").Context'],
  ['rsh/Engine/core/native-agent', 'const code = import(target)'],
  ['rsh/Engine/core/native-agent', 'import type { Missing } from "@deepseek-ai/dsh-missing"'],
  ['rsh/Core/util/json-rpc-line', 'import type { Agent } from "hidden-engine"'],
])('rejects a transitional native source edge from %s: %s', (owner, content) => {
  const root = fixture('export {}')
  writeFileSync(join(root, owner, 'src/index.ts'), content)
  expect(collectNativeDependencyViolations(root)).toContainEqual(expect.stringContaining('native source cannot'))
})

it('admits a transitional native local and Node built-in edge', () => {
  const root = fixture('export {}')
  const owner = 'rsh/Engine/core/native-agent'
  writeFileSync(join(root, owner, 'src/index.ts'), 'import type { Local } from "./local.ts"\nimport type { Stats } from "node:fs"')
  writeFileSync(join(root, owner, 'src/local.ts'), 'export interface Local {}')
  expect(collectNativeDependencyViolations(root)).toEqual([])
})

it('requires each new Engine native entry to have a source-owner classification', () => {
  const root = fixture('export {}')
  const dir = join(root, 'rsh/Engine/core/native-unclassified')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/native.ts'), 'export {}')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-native-unclassified', exports: { './native': './lib/native.js' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: [] } },
  }))
  expect(collectNativeDependencyViolations(root)).toContainEqual(
    expect.stringContaining('native-unclassified: native entry source owner is not classified'),
  )
})

it('keeps a mixed Cordis and native package explicitly classified', () => {
  const root = fixture('export {}')
  const dir = join(root, 'rsh/Modules/Official/fs/fs-local')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/native.ts'), 'export {}')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-fs-local', exports: { './native': { types: './lib/types/native.d.ts', default: './lib/native.js' } },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['fs'] } },
  }))
  expect(collectNativeDependencyViolations(root)).toEqual([])
})

it('checks a mixed native library export without an installer manifest', () => {
  const root = fixture('export {}')
  const dir = join(root, 'rsh/Modules/Official/credentials/credentials')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-credentials',
    exports: { './native': { types: './lib/types/native.d.ts', default: './lib/native.js' } },
  }))
  writeFileSync(join(dir, 'src/native.ts'), 'export type { Credential } from "./native-types.ts"')
  writeFileSync(join(dir, 'src/native-types.ts'), 'export interface Credential {}')
  expect(collectNativeDependencyViolations(root)).toEqual([])
  writeFileSync(join(dir, 'src/native-types.ts'), 'import type { Context } from "@deepseek-ai/cordis"\nexport interface Credential {}')
  expect(collectNativeDependencyViolations(root)).toContainEqual(expect.stringContaining('@deepseek-ai/cordis'))
})

it.each([
  ['import type { Context } from "hidden-framework"', 'hidden-framework'],
  ['export type { Context } from "@deepseek-ai/cordis"', '@deepseek-ai/cordis'],
  ['const value = import(target)', 'cannot compute a module target'],
])('rejects a mixed native entry transitive source edge: %s', (content, diagnostic) => {
  const root = fixture('export {}')
  const dir = join(root, 'rsh/Modules/Official/fs/fs-local')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-fs-local',
    exports: { './native': { types: './lib/types/native.d.ts', default: './lib/native.js' } },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['fs'] } },
  }))
  writeFileSync(join(dir, 'src/native.ts'), 'export type { Broken } from "./backend.ts"')
  writeFileSync(join(dir, 'src/backend.ts'), content + '\nexport interface Broken {}')
  expect(collectNativeDependencyViolations(root)).toContainEqual(expect.stringContaining(diagnostic))
})

it('follows a mixed native entry through its own package export', () => {
  const root = fixture('export {}')
  const dir = join(root, 'rsh/Modules/Official/fs/fs-local')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh-fs-local',
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './native': { types: './lib/types/native.d.ts', default: './lib/native.js' },
    },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['fs'] } },
  }))
  writeFileSync(join(dir, 'src/native.ts'), 'import type { Legacy } from "@deepseek-ai/dsh-fs-local"')
  writeFileSync(join(dir, 'src/index.ts'), 'import type { Context } from "@deepseek-ai/cordis"\nexport interface Legacy {}')
  expect(collectNativeDependencyViolations(root)).toContainEqual(expect.stringContaining('@deepseek-ai/cordis'))
})

it('rejects a classified mixed package without a resolvable native source entry', () => {
  const root = fixture('export {}')
  const dir = join(root, 'rsh/Modules/Official/fs/fs-local')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/native.ts'), 'export {}')
  const manifest = {
    name: '@deepseek-ai/dsh-fs-local',
    exports: { './native': { types: './lib/types/../../index.d.ts', default: './lib/native.js' } },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['fs'] } },
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  expect(collectNativeDependencyViolations(root)).toContainEqual(expect.stringContaining('no supported source declaration path'))
  delete (manifest as { dsh?: unknown }).dsh
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  expect(collectNativeDependencyViolations(root)).toContainEqual(expect.stringContaining('classified mixed package has no valid native entry'))
})

it('rejects a native manifest whose entry is not a published export', () => {
  const root = fixture('export {}')
  const path = join(root, 'rsh/Core/runtime-diagnostics/native-runtime/package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  manifest.exports = { '.': './lib/index.js' }
  manifest.dsh = { native: {
    apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: [],
  } }
  writeFileSync(path, JSON.stringify(manifest))
  expect(collectNativeDependencyViolations(root)).toContainEqual(expect.stringContaining('published package export'))
})
