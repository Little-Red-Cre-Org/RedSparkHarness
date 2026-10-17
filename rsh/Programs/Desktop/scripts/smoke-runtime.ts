/** Boot the materialized target runtime without access to a user's Harness profile. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DesktopHostProcess } from '../src/host-process.ts'
import { desktopHostEnvironment } from '../src/host-environment.ts'
import { createNativeDesktopProfile } from '../src/project-manager.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'

/**
 * Prove the final resource tree boots and serves its matching Web frontend.
 * @param root - Materialized dsh resources.
 * @param node - Prepared target Node executable.
 * @param runtime - Verified resource descriptor.
 */
export async function smokeDesktopRuntime(root: string, node: string, runtime: DesktopRuntimeDescriptor): Promise<void> {
  const environment = desktopHostEnvironment(process.platform === 'win32'
    ? join(dirname(node), '..', 'bash', 'usr', 'bin') : undefined, process.env)
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  const host = new DesktopHostProcess(node, root, profile, undefined, { ...environment, DSH_HOME: home })
  try {
    createNativeDesktopProfile(profile, home)
    const ready = await host.start()
    if (ready.dshVersion !== runtime.release.version) throw new Error('desktop runtime: Host reported another dsh release')
    const response = await host.fetch(new Request('dsh-app://app/'))
    if (response.status !== 200 || !(await response.text()).includes('<html')) {
      throw new Error('desktop runtime: packaged frontend smoke failed')
    }
  } finally {
    await host.stop()
    rmSync(home, { recursive: true, force: true })
  }
}
