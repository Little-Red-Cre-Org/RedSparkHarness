/** Native Host browse provider over a real temporary directory. */

import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { DirectoryPickerError } from '@redspark/rsh-host-directory-picker/error'
import type { NativeDirectoryPicker } from '@redspark/rsh-host-directory-picker/native-capability'
import { plugin, resolveDirectoryBrowseConfig, type DirectoryBrowseService } from '../src/native.ts'

describe('native directory browse', () => {
  it('defaults maxEntries to 1000 and rejects a working directory or a non-positive bound', () => {
    expect(resolveDirectoryBrowseConfig(undefined)).toEqual({ maxEntries: 1000 })
    expect(Object.isFrozen(resolveDirectoryBrowseConfig(undefined))).toBe(true)
    expect(resolveDirectoryBrowseConfig({})).toEqual({ maxEntries: 1000 })
    expect(resolveDirectoryBrowseConfig({ maxEntries: 1 }).maxEntries).toBe(1)
    for (const input of [null, [], 'path', { cwd: '/tmp' }, { maxEntries: 0 }, { maxEntries: 1.5 }, { maxEntries: -1 }]) {
      expect(() => resolveDirectoryBrowseConfig(input)).toThrow()
      expect(() => plugin.resolve(input)).toThrow()
    }
  })

  it('lists one temp level, creates a child, and rejects a path that is not fully qualified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browse-native-'))
    const scope = new NativeScope()
    let browse: DirectoryBrowseService | undefined
    let picker: NativeDirectoryPicker | undefined
    const consumer: NativePlugin = {
      apiVersion: 1,
      name: 'directory-browse-consumer',
      targets: ['host'],
      requires: ['directoryBrowse', 'directoryPicker'],
      provides: [],
      resolve: () => (context) => {
        browse = context.require('directoryBrowse')
        picker = context.require('directoryPicker')
      },
    }
    const host = new NativeHost(resolveInstallation([
      { plugin: consumer, scope, config: undefined },
      { plugin, scope, config: { maxEntries: 1 } },
    ], 'host'))
    try {
      await host.start()
      if (browse === undefined || picker === undefined) throw new Error('directoryBrowse was not installed')
      expect(picker.capability()).toMatchObject({ kind: 'browse', list: browse.list, createDirectory: browse.createDirectory })
      await mkdir(join(root, 'a'))
      await mkdir(join(root, 'b'))
      const listing = await browse.list(root, new AbortController().signal)
      expect(listing.path).toBe(root)
      expect(listing.entries.map(entry => entry.name)).toEqual(['a'])
      expect(listing.truncated).toBe(true)
      const created = await browse.createDirectory(root, 'c')
      expect(created).toBe(join(root, 'c'))
      expect((await stat(created)).isDirectory()).toBe(true)
      const listFailure = await browse.list('relative').catch((error: unknown) => error)
      expect(listFailure).toBeInstanceOf(DirectoryPickerError)
      expect(listFailure).toMatchObject({ code: 'directory-unreadable', path: 'relative' })
      const createFailure = await browse.createDirectory('relative', 'child').catch((error: unknown) => error)
      expect(createFailure).toBeInstanceOf(DirectoryPickerError)
      expect(createFailure).toMatchObject({ code: 'directory-create-failed', path: 'relative' })
    } finally {
      await host.stop()
      await rm(root, { recursive: true, force: true })
    }
  })
})
