/** Copy an explicitly supplied Windows Bash distribution into build-owned resources. */
import { cpSync, lstatSync, mkdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { desktopHostEnvironment } from '../src/host-environment.ts'

/**
 * Replace the build-owned Bash tree after validating its required executables.
 * @param source - Prepared distribution root, separate from the destination.
 * @param runtimeRoot - Desktop build-owned runtime directory; only its bash child is replaced.
 */
export function prepareWindowsBash(source: string, runtimeRoot: string): void {
  const input = realpathSync(source)
  desktopHostEnvironment(resolve(input, 'usr/bin'), {})
  mkdirSync(runtimeRoot, { recursive: true })
  const output = resolve(realpathSync(runtimeRoot), 'bash')
  const contains = (parent: string, child: string): boolean => {
    const path = relative(parent, child)
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  }
  if (contains(input, output) || contains(output, input)) {
    throw new Error('desktop runtime: Bash source and destination must not overlap')
  }
  if (lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(output)
  else rmSync(output, { recursive: true, force: true })
  cpSync(input, output, { recursive: true })
  desktopHostEnvironment(resolve(output, 'usr/bin'), {})
}
