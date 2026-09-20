import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { prepareWindowsBash } from '../scripts/prepare-bash.ts'

it('replaces only the owned Bash child and rejects overlapping input', () => {
  const root = mkdtempSync(join(tmpdir(), 'rsh-bash-prepare-'))
  try {
    const source = join(root, 'source')
    const runtime = join(root, 'runtime')
    mkdirSync(join(source, 'usr/bin'), { recursive: true })
    writeFileSync(join(source, 'usr/bin/bash.exe'), 'bash')
    writeFileSync(join(source, 'usr/bin/msys-2.0.dll'), 'runtime')
    mkdirSync(join(runtime, 'bash'), { recursive: true })
    writeFileSync(join(runtime, 'bash/stale'), 'old')
    writeFileSync(join(runtime, 'keep'), 'keep')
    prepareWindowsBash(source, runtime)
    expect(readFileSync(join(runtime, 'bash/usr/bin/msys-2.0.dll'), 'utf8')).toBe('runtime')
    expect(existsSync(join(runtime, 'bash/stale'))).toBe(false)
    expect(readFileSync(join(runtime, 'keep'), 'utf8')).toBe('keep')
    expect(() => { prepareWindowsBash(join(runtime, 'bash'), runtime) }).toThrow('must not overlap')
    expect(readFileSync(join(runtime, 'bash/usr/bin/bash.exe'), 'utf8')).toBe('bash')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('rejects an incomplete distribution before replacing existing resources', () => {
  const root = mkdtempSync(join(tmpdir(), 'rsh-bash-incomplete-'))
  try {
    const source = join(root, 'source')
    const runtime = join(root, 'runtime')
    mkdirSync(join(source, 'usr/bin'), { recursive: true })
    writeFileSync(join(source, 'usr/bin/bash.exe'), 'bash')
    mkdirSync(join(runtime, 'bash'), { recursive: true })
    writeFileSync(join(runtime, 'bash/keep'), 'existing runtime')
    expect(() => { prepareWindowsBash(source, runtime) }).toThrow('msys-2.0.dll')
    expect(readFileSync(join(runtime, 'bash/keep'), 'utf8')).toBe('existing runtime')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('replaces a destination link without modifying its target', () => {
  const root = mkdtempSync(join(tmpdir(), 'rsh-bash-link-'))
  const runtime = join(root, 'runtime')
  const output = join(runtime, 'bash')
  try {
    const source = join(root, 'source')
    const protectedDirectory = join(root, 'protected')
    mkdirSync(join(source, 'usr/bin'), { recursive: true })
    writeFileSync(join(source, 'usr/bin/bash.exe'), 'bash')
    writeFileSync(join(source, 'usr/bin/msys-2.0.dll'), 'runtime')
    mkdirSync(runtime)
    mkdirSync(protectedDirectory)
    writeFileSync(join(protectedDirectory, 'keep'), 'protected bytes')
    symlinkSync(protectedDirectory, output, process.platform === 'win32' ? 'junction' : 'dir')
    prepareWindowsBash(source, runtime)
    expect(lstatSync(output).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(output, 'usr/bin/bash.exe'), 'utf8')).toBe('bash')
    expect(readFileSync(join(protectedDirectory, 'keep'), 'utf8')).toBe('protected bytes')
    expect(existsSync(join(protectedDirectory, 'usr'))).toBe(false)
  } finally {
    if (lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(output)
    rmSync(root, { recursive: true, force: true })
  }
})
