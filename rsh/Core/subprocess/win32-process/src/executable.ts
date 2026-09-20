/** Windows executable lookup shared by ordinary and restricted process launchers. */

import { lstatSync, statSync } from 'node:fs'

function windowsEnvironmentValue(
  env: Readonly<Record<string, string | undefined>>,
  name: 'PATH' | 'NODEFAULTCURRENTDIRECTORYINEXEPATH',
): string | undefined {
  for (const key of Object.keys(env).sort()) {
    if (key.toUpperCase() === name) return env[key]
  }
  return undefined
}

function executableCandidateExists(candidate: string): boolean {
  try {
    return !statSync(candidate).isDirectory()
  } catch {
    try {
      const entry = lstatSync(candidate)
      return entry.isFile() || entry.isSymbolicLink()
    } catch {
      return false
    }
  }
}

function windowsPathDirectories(path: string): string[] {
  const directories: string[] = []
  let start = 0
  while (start < path.length) {
    if (path.charAt(start) === ';') {
      start += 1
      continue
    }
    const quote = path.charAt(start)
    const quoted = quote === '"' || quote === "'"
    const quoteEnd = quoted
      ? path.indexOf(quote, start + 1)
      : -1
    const separator = path.indexOf(';', quoted ? quoteEnd < 0 ? path.length : quoteEnd : start)
    const end = separator < 0 ? path.length : separator
    let directory = path.slice(start, end)
    if (directory.startsWith('"') || directory.startsWith("'")) directory = directory.slice(1)
    if (directory.endsWith('"') || directory.endsWith("'")) directory = directory.slice(0, -1)
    if (directory.length > 0) directories.push(directory)
    start = end + 1
  }
  return directories
}

function windowsFileNameStart(command: string): number {
  let start = command.length
  while (start > 0 && !/[\\/:]/u.test(command.charAt(start - 1))) start -= 1
  return start
}

function windowsSearchPathJoin(directory: string, name: string, cwd: string): string {
  let prefix = cwd
  let adjustedDirectory = directory
  const slash = (value: string): boolean => value === '\\' || value === '/'
  if (directory.length > 2 && slash(directory.charAt(0)) && slash(directory.charAt(1))) {
    prefix = ''
  } else if (directory.length >= 1 && slash(directory.charAt(0))) {
    prefix = cwd.slice(0, 2)
  } else if (
    directory.length >= 2
    && directory.charAt(1) === ':'
    && (directory.length < 3 || !slash(directory.charAt(2)))
  ) {
    if (cwd.length < 2 || cwd.slice(0, 2).toLowerCase() !== directory.slice(0, 2).toLowerCase()) {
      prefix = ''
    } else {
      adjustedDirectory = directory.slice(2)
    }
  } else if (directory.length > 2 && directory.charAt(1) === ':') {
    prefix = ''
  }

  const append = (base: string, part: string): string => {
    if (base.length === 0 || part.length === 0) return base + part
    return /[\\/:]$/u.test(base) ? base + part : `${base}\\${part}`
  }
  return append(append(prefix, adjustedDirectory), name)
}

function windowsExecutableNames(command: string, name: string): string[] {
  const dot = name.indexOf('.')
  const hasExtension = dot >= 0 && dot < name.length - 1
  const separator = name.endsWith('.') ? '' : '.'
  return [
    ...hasExtension ? [command] : [],
    `${command}${separator}com`,
    `${command}${separator}exe`,
  ]
}

/**
 * Resolve the executable path with libuv/Node Windows spawn search order while
 * preserving the caller's original command-line argv entry separately.
 * @param command - original target argv[0].
 * @param cwd - final target working directory used for relative search roots.
 * @param env - final target environment containing the child PATH.
 * @param exists - injectable non-directory candidate probe used by tests.
 * @param currentEnv - runner environment supplying PATH fallback and cwd-search policy.
 * @returns a resolved application name suitable for `CreateProcessW`, or undefined when no candidate exists.
 */
export function resolveWindowsExecutable(
  command: string,
  cwd: string,
  env: Readonly<Record<string, string>>,
  exists: (candidate: string) => boolean = executableCandidateExists,
  currentEnv: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const nameStart = windowsFileNameStart(command)
  const directory = command.slice(0, nameStart)
  const name = command.slice(nameStart)
  const hasPath = nameStart !== 0
  const roots: string[] = []
  if (hasPath) {
    roots.push(directory)
  } else {
    if (windowsEnvironmentValue(currentEnv, 'NODEFAULTCURRENTDIRECTORYINEXEPATH') === undefined) {
      roots.push('')
    }
    const path = windowsEnvironmentValue(env, 'PATH') ?? windowsEnvironmentValue(currentEnv, 'PATH') ?? ''
    roots.push(...windowsPathDirectories(path))
  }

  for (const root of roots) {
    const base = windowsSearchPathJoin(root, name, cwd)
    for (const candidate of windowsExecutableNames(base, name)) {
      if (exists(candidate)) return candidate
    }
  }

  return undefined
}
