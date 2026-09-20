import { globSync, readFileSync } from 'node:fs'
import { matchesGlob, resolve } from 'node:path'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'
import { PACKAGE_MANIFEST_GLOBS, WORKSPACE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'

it('keeps npm and pnpm workspaces aligned with source manifests and excludes build payloads', () => {
  const cwd = resolve(import.meta.dirname, '../..')
  const npm = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')) as { workspaces: string[] }
  const pnpm = load(readFileSync(resolve(cwd, 'pnpm-workspace.yaml'), 'utf8')) as { packages: string[] }
  expect([...npm.workspaces].sort()).toEqual([...pnpm.packages].sort())
  const normalize = (path: string): string => path.replaceAll('\\', '/')
  const expected = globSync([...WORKSPACE_MANIFEST_GLOBS], { cwd }).map(normalize).sort()
  const actual = globSync(pnpm.packages.map(path => `${path}/package.json`), { cwd }).map(normalize).sort()
  expect(actual).toEqual(expected)
  for (const artifact of [
    'rsh/Programs/SDK/python/sdk-runtime/src/deepseek_harness_runtime/runtime/node',
    'rsh/Programs/Desktop/.desktop-build/targets/win-x64/app',
    'rsh/Programs/CLI/tests/fixtures/workspace',
  ]) {
    expect(pnpm.packages.filter(pattern => matchesGlob(artifact, pattern)), artifact).toEqual([])
  }
})

it('includes every source-owning package in the workspace manifest inventory', () => {
  const cwd = resolve(import.meta.dirname, '../..')
  const normalize = (path: string): string => path.replaceAll('\\', '/')
  const packages = globSync([...PACKAGE_MANIFEST_GLOBS], { cwd }).map(normalize)
  const workspaces = new Set(globSync([...WORKSPACE_MANIFEST_GLOBS], { cwd }).map(normalize))
  expect(packages.length).toBeGreaterThan(0)
  expect(packages.filter(path => !workspaces.has(path))).toEqual([])
})
