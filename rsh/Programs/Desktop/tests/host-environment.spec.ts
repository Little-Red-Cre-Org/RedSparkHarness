import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopHostEnvironment } from '../src/host-environment.ts'

describe('desktop backend environment', () => {
  it('preserves development environments without alias normalization', () => {
    const source = { Path: 'ambient', VALUE: 'kept' }
    expect(desktopHostEnvironment(undefined, source)).toEqual(source)
    expect(desktopHostEnvironment(undefined, source)).not.toBe(source)
  })

  it('requires both packaged files and prepends one PATH without mutating the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'rsh-bash-env-'))
    try {
      expect(() => desktopHostEnvironment(root, {})).toThrow('missing packaged Windows Bash file')
      writeFileSync(join(root, 'bash.exe'), '')
      expect(() => desktopHostEnvironment(root, {})).toThrow('msys-2.0.dll')
      writeFileSync(join(root, 'msys-2.0.dll'), '')
      const source = { Path: 'ambient', VALUE: 'kept' }
      expect(desktopHostEnvironment(root, source)).toEqual({ PATH: `${root};ambient`, VALUE: 'kept' })
      expect(source).toEqual({ Path: 'ambient', VALUE: 'kept' })
      expect(desktopHostEnvironment(root, {})).toEqual({ PATH: root })
      expect(desktopHostEnvironment(root, { PATH: 'upper', Path: 'mixed' })).toEqual({ PATH: `${root};upper` })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
