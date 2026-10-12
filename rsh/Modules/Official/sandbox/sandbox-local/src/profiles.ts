/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { isAbsolute, parse, posix, relative, sep } from 'node:path'
import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-system/landlock-run'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox/native'
import type { ProcessSandboxChildPaths, SandboxPolicy } from '@deepseek-ai/dsh-sandbox/native'

/**
 * Build the bwrap profile arguments for one file-effect policy.
 * @param policy - file-effect policy to express as bwrap mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent']
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
  }
  return args
}

function containsPath(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

function isHiddenByTmpfs(path: string): boolean {
  if (!posix.isAbsolute(path)) return false
  const child = posix.relative('/tmp', path)
  return child !== '' && child !== '..' && !child.startsWith('../') && !posix.isAbsolute(child)
}

function pathDepth(path: string): number {
  return relative(parse(path).root, path).split(sep).filter(Boolean).length
}

/**
 * Build bwrap mounts for one SDK child without exposing the host temp tree.
 * @param policy - the child's resolved file-effect policy.
 * @param paths - canonical child cwd and launcher-owned private home.
 * @returns profile arguments, including the child's in-namespace cwd.
 */
export function bwrapChildProfileArgs(policy: SandboxPolicy, paths: ProcessSandboxChildPaths): string[] {
  const cwd = canonicalPath(paths.cwd)
  const privateHome = canonicalPath(paths.privateHome)
  const workspaceRoot = canonicalPath(policy.workspaceRoot)
  if (![cwd, privateHome, workspaceRoot].every(path => isAbsolute(path))) {
    throw new Error('sandbox-local: confined child paths must be absolute')
  }
  const readOnlyChild = policy.mode === 'read-only'
  if (readOnlyChild && containsPath(privateHome, cwd)) {
    throw new Error('sandbox-local: a read-only child cwd cannot be inside its writable private home')
  }

  const workspaceWritable = !readOnlyChild
  const cwdWritable = workspaceWritable && containsPath(workspaceRoot, cwd)
  const homeWritableByWorkspace = workspaceWritable && containsPath(workspaceRoot, privateHome)
  const cwdNeedsReadOnlyBind = workspaceWritable && isHiddenByTmpfs(cwd)
    && !cwdWritable && !containsPath(privateHome, cwd)
  const homeNeedsWritableBind = !homeWritableByWorkspace
  const mounts: Array<{ source: string; target: string; access: 'read' | 'write' }> = []
  if (cwdNeedsReadOnlyBind) mounts.push({ source: cwd, target: cwd, access: 'read' })
  if (workspaceWritable) mounts.push({ source: workspaceRoot, target: workspaceRoot, access: 'write' })
  if (homeNeedsWritableBind) mounts.push({ source: privateHome, target: privateHome, access: 'write' })

  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent']
  if (workspaceWritable) args.push('--tmpfs', '/tmp')

  const orderedMounts = [
    ...mounts.filter(({ access }) => access === 'read'),
    ...mounts.filter(({ access }) => access === 'write')
      .sort((left, right) => pathDepth(left.target) - pathDepth(right.target)),
  ]
  for (const mount of orderedMounts) {
    args.push(
      mount.access === 'read' ? '--ro-bind' : '--bind',
      mount.source,
      mount.target,
    )
  }
  args.push('--chdir', cwd)
  return args
}

/**
 * Build the Landlock launcher grants for one file-effect policy.
 * @param policy - file-effect policy to express as Landlock allow-list grants.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}

/**
 * Build Landlock grants for one SDK child, adding only its private home to the policy.
 * @param policy - the child's resolved file-effect policy.
 * @param paths - canonical child cwd and launcher-owned private home.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockChildProfileArgs(policy: SandboxPolicy, paths: ProcessSandboxChildPaths): string[] {
  const readWrite = policy.mode === 'workspace-write' ? ['/dev/null', '/tmp', policy.workspaceRoot] : ['/dev/null']
  const privateHome = canonicalPath(paths.privateHome)
  if (!readWrite.map(canonicalPath).some(root => containsPath(root, privateHome))) {
    readWrite.push(privateHome)
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = writableRoots(policy)
  if (roots.length > 0) {
    forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  }
  return ['-p', forms.join(' ')]
}

/**
 * Build Seatbelt grants for one SDK child, adding only its private home to the policy.
 * @param policy - the child's resolved file-effect policy.
 * @param paths - canonical child cwd and launcher-owned private home.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltChildProfileArgs(policy: SandboxPolicy, paths: ProcessSandboxChildPaths): string[] {
  const forms = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`]
  const roots = [...new Set([...writableRoots(policy), canonicalPath(paths.privateHome)])]
  forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
  return ['-p', forms.join(' ')]
}
