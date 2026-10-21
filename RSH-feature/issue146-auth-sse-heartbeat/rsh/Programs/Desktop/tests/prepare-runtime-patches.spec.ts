import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareRuntimePatches } from '../scripts/prepare-runtime-patches.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('fails without the reviewed patch instead of installing the unpatched dependency', () => {
  const root = mkdtempSync(join(tmpdir(), 'rsh-runtime-patches-'))
  roots.push(root)
  const project = join(root, 'project')
  mkdirSync(project)
  writeFileSync(join(project, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')

  expect(() => { prepareRuntimePatches(project, root) }).toThrow('ENOENT')
  expect(readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8')).toBe('nodeLinker: hoisted\n')
})

it('copies the reviewed patch and preserves generated workspace settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'rsh-runtime-patches-'))
  roots.push(root)
  const project = join(root, 'project')
  mkdirSync(project)
  mkdirSync(join(root, 'patches'))
  const filename = 'node-pty@1.2.0-beta.15.patch'
  writeFileSync(join(root, 'patches', filename), 'reviewed patch\n')
  writeFileSync(join(project, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')

  prepareRuntimePatches(project, root)

  expect(readFileSync(join(project, 'patches', filename), 'utf8')).toBe('reviewed patch\n')
  expect(readFileSync(join(project, 'pnpm-workspace.yaml'), 'utf8')).toBe(
    `nodeLinker: hoisted\npatchedDependencies:\n  node-pty@1.2.0-beta.15: patches/${filename}\n`,
  )
})
