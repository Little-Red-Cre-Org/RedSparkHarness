import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createLegacyDesktopRuntime } from '../src/legacy-host.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('legacy Desktop Host profile boundary', () => {
  it('rejects a native Client profile before creating the compatibility composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-legacy-host-'))
    roots.push(root)
    const project = join(root, 'profile')
    await mkdir(project)
    await writeFile(join(project, 'rsh.client.json'), JSON.stringify({
      formatVersion: 1,
      installations: [{ id: 'application', plugin: '@deepseek-ai/dsh-client-native-application' }],
    }))

    await expect(createLegacyDesktopRuntime(join(root, 'runtime'), project, false))
      .rejects.toThrow('dsh desktop: rsh.client.json requires profile runtime "native"')
    expect(existsSync(join(project, 'desktop.cordis.yml'))).toBe(false)
  })
})
