/** Restricted launch adapters preserve argv and refuse unresolved executables. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveWindowsExecutable, spawnInheritedJobProcess, spawnPipedProcess, Win32Error } from '@deepseek-ai/dsh-win32-process'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import { spawnSandboxed, spawnSandboxedInherited } from '../src/spawn.ts'

vi.mock('@deepseek-ai/dsh-win32-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-win32-process')>()
  return {
    ...actual,
    resolveWindowsExecutable: vi.fn(),
    spawnInheritedJobProcess: vi.fn(),
    spawnPipedProcess: vi.fn(),
  }
})

beforeEach(() => vi.resetAllMocks())

describe.each([
  { name: 'piped', spawn: spawnSandboxed, native: spawnPipedProcess },
  { name: 'inherited', spawn: spawnSandboxedInherited, native: spawnInheritedJobProcess },
])('$name restricted launch', ({ spawn, native }) => {
  // Path resolution and native spawning are mocked; no Win32 bindings are invoked.
  const api = {} as Win32Bindings
  const token = 70n as NativePtr
  const options = { command: 'bash', args: ['-c', 'echo hello'], cwd: 'C:\\workspace' }

  it('passes the resolved application separately from the original argv', () => {
    vi.mocked(resolveWindowsExecutable).mockReturnValue('C:\\Program Files\\Git\\bin\\bash.exe')
    spawn(api, token, options)
    expect(resolveWindowsExecutable).toHaveBeenCalledWith('bash', options.cwd, {})
    expect(native).toHaveBeenCalledWith(api, {
      ...options,
      applicationName: 'C:\\Program Files\\Git\\bin\\bash.exe',
      token: 70n,
    })
  })

  it('fails before native creation when no executable resolves', () => {
    vi.mocked(resolveWindowsExecutable).mockReturnValue(undefined)
    expect(() => spawn(api, token, options)).toThrow(Win32Error)
    expect(native).not.toHaveBeenCalled()
  })
})
