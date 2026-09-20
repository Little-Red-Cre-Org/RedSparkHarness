/** Preserve the installed workspace inventory across pnpm legacy deployment. */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Restore the installed inventory even when deployment fails.
 * The caller must serialize package-manager operations in this workspace.
 * @param root - Installed workspace root, whose state file must exist.
 * @param deploy - Production deployment operation; must not install into the source workspace.
 * @returns Completion after deployment and byte-for-byte inventory restoration.
 */
export async function preservePnpmWorkspaceState(root: string, deploy: () => Promise<void>): Promise<void> {
  const path = join(root, 'node_modules', '.pnpm-workspace-state-v1.json')
  const state = await readFile(path)
  try {
    await deploy()
  } finally {
    await writeFile(path, state)
  }
}
