/** Native skill filesystem provider against the selected local filesystem. */
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation } from '@deepseek-ai/dsh-native-runtime'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { plugin as localFilesystemPlugin } from '@deepseek-ai/dsh-fs-local/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/operations'
import { plugin as skillRegistryPlugin } from '@deepseek-ai/dsh-skill/native'
import type { NativeSkills } from '@deepseek-ai/dsh-skill/native'
import { plugin as filesystemSkillPlugin } from '../src/native.ts'

it('scans through the selected filesystem and uses its host mapping only for watches', { timeout: 15_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rsh-native-skill-filesystem-'))
  try {
    const skillsRoot = join(directory, 'skills')
    await mkdir(skillsRoot)
    await writeSkill(join(skillsRoot, 'seed.md'), 'seed', 'Initial body')

    const noWatch = await mount(skillsRoot, false)
    const unmapped = vi.spyOn(noWatch.filesystem, 'hostPathFor').mockReturnValue(undefined)
    try {
      const snapshot = await noWatch.skills.snapshot({ scope: noWatch.scope, cwd: skillsRoot })
      expect(snapshot.complete).toBe(true)
      expect(snapshot.skills.map(skill => skill.name)).toEqual(['seed'])
      expect(await noWatch.skills.get('seed', { scope: noWatch.scope, cwd: skillsRoot })).toMatchObject({ content: 'Initial body' })

      const addedDirectory = join(skillsRoot, 'added')
      await mkdir(addedDirectory)
      const addedPath = join(addedDirectory, 'SKILL.md')
      const addedTarget = await noWatch.filesystem.resolve(addedPath)
      const change = noWatch.nextChange()
      const write = await noWatch.filesystem.writeText(addedTarget, skillContent('added', 'Added body'))
      noWatch.host.events.emit(noWatch.scope, 'fs/observed', addedTarget, { kind: 'present', version: write.version }, { name: 'write' })
      await expect(withTimeout(change, 10_000)).resolves.toBeUndefined()
      const after = await noWatch.skills.snapshot({ scope: noWatch.scope, cwd: skillsRoot })
      expect(after.complete).toBe(true)
      expect(after.skills.map(skill => skill.name)).toEqual(['added', 'seed'])
      expect(await noWatch.skills.get('added', { scope: noWatch.scope, cwd: skillsRoot })).toMatchObject({ content: 'Added body' })
      expect(unmapped).not.toHaveBeenCalled()
    } finally {
      unmapped.mockRestore()
      await noWatch.host.stop()
    }
    await rm(join(skillsRoot, 'added'), { recursive: true, force: true })

    const watched = await mount(skillsRoot, true)
    try {
      const rootTarget = await watched.filesystem.resolve(skillsRoot)
      const hostPath = watched.filesystem.hostPathFor(watched.filesystem.processPath(rootTarget))
      expect(hostPath).toBe(await realpath(skillsRoot))
      expect(typeof hostPath === 'string' && isAbsolute(hostPath)).toBe(true)

      const before = await watched.skills.snapshot({ scope: watched.scope, cwd: skillsRoot })
      expect(before.complete).toBe(true)
      expect(before.skills.map(skill => skill.name)).toEqual(['seed'])
      expect(await watched.skills.get('seed', { scope: watched.scope, cwd: skillsRoot })).toMatchObject({ content: 'Initial body' })

      const change = watched.nextChange()
      await writeSkill(join(skillsRoot, 'added.md'), 'added', 'Added body')
      await expect(withTimeout(change, 10_000)).resolves.toBeUndefined()
      const after = await watched.skills.snapshot({ scope: watched.scope, cwd: skillsRoot })
      expect(after.skills.map(skill => skill.name)).toEqual(['added', 'seed'])
      expect(await watched.skills.get('added', { scope: watched.scope, cwd: skillsRoot })).toMatchObject({ content: 'Added body' })
    } finally {
      await watched.host.stop()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function mount(skillsRoot: string, watch: boolean): Promise<{
  host: NativeHost
  scope: NativeScope
  filesystem: FileSystemOperations
  skills: NativeSkills
  nextChange: () => Promise<undefined>
}> {
  const scope = new NativeScope()
  let filesystem: FileSystemOperations | undefined
  let skills: NativeSkills | undefined
  const waiters = new Set<PromiseWithResolvers<undefined>>()
  const consumer: NativePlugin = {
    apiVersion: 1,
    name: 'native skill filesystem test consumer',
    targets: ['host'],
    requires: ['fs', 'skills'],
    provides: [],
    resolve: () => (context) => {
      filesystem = context.require('fs')
      skills = context.require('skills')
      const unsubscribe = context.on('skills/change', () => {
        for (const waiter of waiters) waiter.resolve(undefined)
        waiters.clear()
      })
      context.own(async () => { await unsubscribe() })
    },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: consumer, scope, config: undefined },
    { plugin: skillRegistryPlugin, scope, config: undefined },
    { plugin: localFilesystemPlugin, scope, config: { cwd: skillsRoot } },
    { plugin: filesystemSkillPlugin, scope, config: {
      includeDefaultRoots: false,
      customSkillDirs: [skillsRoot],
      watch,
      watchStabilityThresholdMs: 20,
      watchPollIntervalMs: 10,
    } },
  ], 'host'))
  return (async () => {
    try {
      await host.start()
    } catch (error) {
      await host.stop()
      throw error
    }
    if (filesystem === undefined || skills === undefined) throw new Error('Native skill filesystem services were not activated')
    return {
      host,
      scope,
      filesystem,
      skills,
      nextChange() {
        const waiter = Promise.withResolvers<undefined>()
        waiters.add(waiter)
        return waiter.promise.finally(() => { waiters.delete(waiter) })
      },
    }
  })()
}

async function writeSkill(path: string, name: string, body: string): Promise<void> {
  await writeFile(path, skillContent(name, body))
}

function skillContent(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`
}

async function withTimeout<Result>(work: Promise<Result>, timeoutMs: number): Promise<Result> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Native skill change was not observed within ${timeoutMs} ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
