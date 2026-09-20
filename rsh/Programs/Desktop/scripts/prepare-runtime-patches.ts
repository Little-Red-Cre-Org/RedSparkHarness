/** Install the reviewed dependency patches into the Desktop build project. */

import { appendFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bind the Desktop production install to the repository's patched ConPTY sources.
 * @param projectRoot - Fresh generated production project with workspace metadata.
 * @param repositoryRoot - Repository containing the reviewed patch.
 */
export function prepareRuntimePatches(projectRoot: string, repositoryRoot: string): void {
  const filename = 'node-pty@1.2.0-beta.15.patch'
  mkdirSync(join(projectRoot, 'patches'), { recursive: true })
  copyFileSync(join(repositoryRoot, 'patches', filename), join(projectRoot, 'patches', filename))
  appendFileSync(join(projectRoot, 'pnpm-workspace.yaml'), `patchedDependencies:\n  node-pty@1.2.0-beta.15: patches/${filename}\n`)
}
