import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const owner = resolve(import.meta.dirname, '../Core/native/windows-bash')

describe('Windows Bash source preparation', () => {
  it('pins the checked-in patch bytes', () => {
    const manifest = JSON.parse(readFileSync(join(owner, 'upstream.json'), 'utf8')) as { patch: string; patchSha256: string }
    const actual = createHash('sha256').update(readFileSync(join(owner, manifest.patch))).digest('hex')
    expect(actual).toBe(manifest.patchSha256)
  })

  it.skipIf(process.platform !== 'win32')('rejects an invalid archive without creating a destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'rsh-source-reject-'))
    try {
      const archive = join(root, 'invalid.tar.gz')
      writeFileSync(archive, 'not the pinned source')
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(owner, 'prepare-source.ps1'),
        '-Archive', archive, '-Destination', join(root, 'output')], { encoding: 'utf8', timeout: 10000 })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('SHA-256 mismatch')
      expect(readdirSync(root)).toEqual(['invalid.tar.gz'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'win32')('preserves an existing destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'rsh-source-existing-'))
    try {
      const destination = join(root, 'output')
      mkdirSync(destination)
      const sentinel = join(destination, 'keep.txt')
      writeFileSync(sentinel, 'preserved')
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(owner, 'prepare-source.ps1'),
        '-Archive', join(owner, 'upstream.json'), '-Destination', destination], { encoding: 'utf8', timeout: 10000 })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Destination must not exist')
      expect(readdirSync(destination)).toEqual(['keep.txt'])
      expect(readFileSync(sentinel, 'utf8')).toBe('preserved')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe.skipIf(process.platform !== 'win32')('Windows Bash distribution preparation', () => {
  it.each([false, true])('rejects invalid input without changing destination (existing: %s)', (existing) => {
    const root = mkdtempSync(join(tmpdir(), 'rsh-distribution-reject-'))
    try {
      const destination = join(root, 'output')
      const archive = join(root, 'invalid.7z.exe')
      writeFileSync(archive, 'not the pinned PortableGit archive')
      if (existing) {
        mkdirSync(destination)
        writeFileSync(join(destination, 'keep.txt'), 'preserved')
      }
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(owner, 'prepare-distribution.ps1'),
        '-Archive', archive, '-RuntimeDll', join(owner, 'upstream.json'), '-SevenZip', process.execPath,
        '-Destination', destination], { encoding: 'utf8', timeout: 10000 })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(existing ? 'Destination must not exist' : 'PortableGit archive SHA-256 mismatch')
      expect(existsSync(destination)).toBe(existing)
      if (existing) {
        expect(readdirSync(destination)).toEqual(['keep.txt'])
        expect(readFileSync(join(destination, 'keep.txt'), 'utf8')).toBe('preserved')
      }
      expect(readFileSync(archive, 'utf8')).toBe('not the pinned PortableGit archive')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
