/** Syntax forms that must not escape native dependency ownership checks. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import ts from 'typescript'
import { nativePackageDirectories } from './native-package-policy.ts'
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
  for (const owner of nativePackageDirectories) {
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
  write('tsconfig.host.json', JSON.stringify({
    compilerOptions: {
      noLib: true, moduleResolution: 'bundler', module: 'esnext',
      paths: { 'hidden-framework': ['./rsh/Core/vendor/cordis/src/index.ts'] },
    },
    include: [...nativePackageDirectories].map(owner => `${owner}/src/**/*.ts`),
  }))
  write('client.ts', 'export {}')
  write('tsconfig.client.json', JSON.stringify({ compilerOptions: { noLib: true }, files: ['client.ts'] }))
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
