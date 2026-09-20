import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { preservePnpmWorkspaceState } from './preserve-pnpm-workspace-state.ts'

it.each([false, true])('restores installed state after deployment (failure: %s)', async (fails) => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-pnpm-state-'))
  const path = join(root, 'node_modules', '.pnpm-workspace-state-v1.json')
  const original = '{"settings":{"dev":true,"nodeLinker":"isolated"}}\n'
  try {
    await mkdir(join(root, 'node_modules'))
    await writeFile(path, original)
    const failure = new Error('deployment failed')
    const result = preservePnpmWorkspaceState(root, async () => {
      await writeFile(path, '{"settings":{"dev":false,"nodeLinker":"hoisted"}}')
      if (fails) throw failure
    })
    if (fails) await expect(result).rejects.toBe(failure)
    else await result
    expect(await readFile(path, 'utf8')).toBe(original)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('refuses deployment when the installed inventory is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rsh-pnpm-state-'))
  let called = false
  try {
    await expect(preservePnpmWorkspaceState(root, async () => { called = true })).rejects.toThrow()
    expect(called).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
