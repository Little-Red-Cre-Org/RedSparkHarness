/** Built child process under the platform's real file-confinement runner. */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NativeSandboxPolicy } from '@deepseek-ai/dsh-native-sandbox-policy'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { LocalSubprocessController } from '@deepseek-ai/dsh-subprocess-local/src/controller.ts'
import { LocalSandboxBackend, resolveConfig } from '@deepseek-ai/dsh-sandbox-local/src/backend.ts'
import { resolveNativeWorkerThreadConfig } from '@deepseek-ai/dsh-native-code-runtime'

const built = new URL('../lib/index.js', import.meta.url)

describe('built process-sandbox code runtime', () => {
  it('runs a program and denies a file write under the real read-only runner', async () => {
    if (!existsSync(built)) throw new Error('build code-runtime-process-sandbox before this built-provider check')
    const workspace = await mkdtemp(join(homedir(), 'dsh-code-runtime-sandbox-'))
    const subprocess = new LocalSubprocessController(() => {})
    const sandbox = new LocalSandboxBackend(resolveConfig(undefined), () => {})
    const { ProcessSandboxCodeRuntime } = await import(built.href) as typeof import('../src/index.ts')
    const runtime = new ProcessSandboxCodeRuntime(subprocess, sandbox,
      new NativeSandboxPolicy({ mode: 'read-only', workspaceRoot: workspace }),
      resolveNativeWorkerThreadConfig({ computeMs: 2_000, maxWallMs: 10_000, maxOutputBytes: 1_048_576 }))
    const id = SessionId('process-sandbox-built-e2e')
    const session = Session.create(id, undefined, {
      version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: workspace, isSeeded: false, delegationDepth: 0,
    })
    const target = join(workspace, 'denied.txt')
    try {
      await expect(runtime.run({ program: 'return 42', bindings: [], session }))
        .resolves.toEqual({ logs: [], value: 42 })
      const largePath = join(workspace, 'large.txt')
      await writeFile(largePath, 'x'.repeat(1_048_577))
      await expect(runtime.run({
        program: 'const text = await files.read({}); return text.length',
        session,
        bindings: [{ global: 'files', functions: { read: async () => readFile(largePath, 'utf8') } }],
      })).resolves.toEqual({ logs: [], value: 1_048_577 })
      const attempt = await runtime.run({
        program: `const fs = await import('node:fs'); fs.writeFileSync(${JSON.stringify(target)}, 'escaped'); return true`,
        bindings: [], session,
      })
      expect(attempt.error?.kind).toBe('exception')
      expect(existsSync(target)).toBe(false)
    } finally {
      await runtime.dispose()
      await subprocess.dispose()
      sandbox.dispose()
      await rm(workspace, { recursive: true, force: true })
    }
  }, 30_000)
})
