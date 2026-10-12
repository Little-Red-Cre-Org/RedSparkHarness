import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox/native'
import type { ProcessSandboxChildPaths } from '@deepseek-ai/dsh-sandbox/native'
import { bwrapProfileArgs } from '../src/profiles.ts'
import { LocalSandboxBackend, resolveConfig } from '../src/backend.ts'

const probe = process.platform === 'linux'
  ? spawnSync('bwrap', [...bwrapProfileArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', 'true'], { timeout: 5_000, stdio: 'ignore' })
  : undefined
const bwrapUsable = probe?.status === 0
if (process.platform === 'linux' && process.env.DSH_REQUIRE_BWRAP_E2E === '1' && !bwrapUsable) {
  throw new Error('sandbox-local: required bwrap e2e probe failed')
}

const tempDirs: string[] = []
const backends: LocalSandboxBackend[] = []

afterEach(async () => {
  for (const backend of backends.splice(0)) backend.dispose()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(base: string): Promise<string> {
  const dir = await mkdtemp(join(base, 'dsh-child-bwrap-e2e-'))
  tempDirs.push(dir)
  return dir
}

async function backend(): Promise<LocalSandboxBackend> {
  const selected = new LocalSandboxBackend(resolveConfig({}), (failures) => {
    throw new AggregateError(failures, 'sandbox-local: test child backend cleanup failed')
  })
  selected.internals = { platform: 'linux', probeBwrap: () => true }
  backends.push(selected)
  return selected
}

function runChild(
  sandbox: LocalSandboxBackend,
  policy: SandboxPolicy,
  paths: { cwd: string; privateHome: string },
  command: string[],
  extraEnv: Record<string, string> = {},
) {
  const confined = sandbox.confineChildProcess(['bash', '-c', command.join(' && ')], policy, paths)
  return spawnSync(confined.argv[0] as string, confined.argv.slice(1), {
    timeout: 30_000,
    encoding: 'utf8',
    env: { ...process.env, DSH_CHILD_CWD: paths.cwd, DSH_CHILD_HOME: paths.privateHome, ...extraEnv },
  })
}

describe.skipIf(process.platform !== 'linux' || !bwrapUsable)('sandbox-local: SDK child bwrap mounts', () => {
  it('restores the selected cwd and private home without exposing sibling /tmp paths', async () => {
    const parentTemp = await tempDir('/tmp')
    const cwd = await tempDir(parentTemp)
    const privateHome = await tempDir(parentTemp)
    const hostSibling = await tempDir(parentTemp)
    const workspace = await tempDir(homedir())
    const hostSiblingFile = join(hostSibling, 'host-only.txt')
    const sandbox = await backend()
    writeFileSync(join(privateHome, 'provider.json'), '{"provider":"fixture"}')
    writeFileSync(hostSiblingFile, 'host-only')
    writeFileSync(join(cwd, 'visible.txt'), 'cwd-visible')

    const result = runChild(sandbox, { mode: 'workspace-write', workspaceRoot: workspace }, { cwd, privateHome }, [
      'test "$PWD" = "$DSH_CHILD_CWD"',
      'test "$(cat "$DSH_CHILD_HOME/provider.json")" = \'{"provider":"fixture"}\'',
      'printf home-ok > "$DSH_CHILD_HOME/owned.txt"',
      'printf workspace-ok > "$DSH_PARENT_WORKSPACE/owned.txt"',
      'test ! -e "$DSH_HOST_SIBLING/host-only.txt"',
      'test "$(cat "$DSH_CHILD_CWD/visible.txt")" = cwd-visible',
      'if printf denied > denied.txt 2>/dev/null; then exit 21; fi',
    ], { DSH_PARENT_WORKSPACE: workspace, DSH_HOST_SIBLING: hostSibling })

    expect(result.status).toBe(0)
    expect(readFileSync(join(privateHome, 'owned.txt'), 'utf8')).toBe('home-ok')
    expect(readFileSync(join(workspace, 'owned.txt'), 'utf8')).toBe('workspace-ok')
    expect(readFileSync(hostSiblingFile, 'utf8')).toBe('host-only')
    expect(existsSync(join(cwd, 'denied.txt'))).toBe(false)
  })

  it('keeps a read-only selected cwd visible while the private home remains writable', async () => {
    const parentTemp = await tempDir('/tmp')
    const cwd = await tempDir(parentTemp)
    const privateHome = await tempDir(parentTemp)
    const sandbox = await backend()
    writeFileSync(join(privateHome, 'provider.json'), '{"provider":"fixture"}')
    writeFileSync(join(cwd, 'visible.txt'), 'cwd-visible')

    const result = runChild(sandbox, { mode: 'read-only', workspaceRoot: privateHome }, { cwd, privateHome }, [
      'test "$PWD" = "$DSH_CHILD_CWD"',
      'test "$(cat "$DSH_CHILD_HOME/provider.json")" = \'{"provider":"fixture"}\'',
      'test "$(cat "$DSH_CHILD_CWD/visible.txt")" = cwd-visible',
      'printf home-ok > "$DSH_CHILD_HOME/owned.txt"',
      'if printf denied > denied.txt 2>/dev/null; then exit 22; fi',
    ])

    expect(result.status).toBe(0)
    expect(readFileSync(join(privateHome, 'owned.txt'), 'utf8')).toBe('home-ok')
    expect(existsSync(join(cwd, 'denied.txt'))).toBe(false)
  })
})

it.skipIf(process.platform !== 'win32')('forwards canonical Windows child paths to the operator-asserted profile', async () => {
  const workspace = await tempDir(tmpdir())
  const cwd = await tempDir(tmpdir())
  const privateHome = await tempDir(tmpdir())
  const paths: ProcessSandboxChildPaths = { cwd, privateHome }
  const sandbox = new LocalSandboxBackend(resolveConfig({
    runnerCommand: ['fake-runner', '--flag'],
    runnerFailureSignatures: ['fake-runner: profile rejected'],
  }), (failures) => {
    throw new AggregateError(failures, 'sandbox-local: test child backend cleanup failed')
  })
  backends.push(sandbox)

  const confined = sandbox.confineChildProcess(
    ['node', 'child.mjs'],
    { mode: 'workspace-write', workspaceRoot: workspace },
    paths,
  )
  expect(confined.argv).toEqual([
    'fake-runner', '--flag',
    '--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent',
    '--tmpfs', '/tmp',
    '--bind', canonicalPath(workspace), canonicalPath(workspace),
    '--bind', canonicalPath(privateHome), canonicalPath(privateHome),
    '--chdir', canonicalPath(cwd), '--', 'node', 'child.mjs',
  ])
})
