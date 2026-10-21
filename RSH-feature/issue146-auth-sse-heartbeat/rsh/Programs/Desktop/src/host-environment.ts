/** Process-local selection of the packaged Windows Bash runtime. */
import { statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Prepend the owned Bash directory without changing the caller's environment.
 * @param bashDirectory - Packaged Windows usr/bin directory; absent for development and other platforms.
 * @param environment - Environment inherited by the backend.
 * @returns A fresh environment with one case-insensitive PATH key.
 */
export function desktopHostEnvironment(bashDirectory: string | undefined, environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (bashDirectory === undefined) return { ...environment }
  for (const file of ['bash.exe', 'msys-2.0.dll']) {
    if (!statSync(join(bashDirectory, file), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`desktop runtime: missing packaged Windows Bash file ${join(bashDirectory, file)}`)
    }
  }
  const pathKey = Object.keys(environment).sort().find(key => key.toLowerCase() === 'path')
  const inheritedPath = pathKey === undefined ? undefined : environment[pathKey]
  const result = Object.fromEntries(Object.entries(environment).filter(([key]) => key.toLowerCase() !== 'path'))
  return { ...result, PATH: inheritedPath ? `${bashDirectory};${inheritedPath}` : bashDirectory }
}
