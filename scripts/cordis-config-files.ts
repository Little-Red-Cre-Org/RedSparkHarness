/** Cordis Loader configuration file discovery. */

import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

/** Read a Loader config, including Git symlink placeholders in Windows checkouts.
 * @param root - Repository root.
 * @param file - Repository-relative configuration path.
 * @returns Configuration text; ordinary scalar YAML remains unchanged for validation.
 */
export function readCordisConfigFile(root: string, file: string): string {
  const path = resolve(root, file)
  const text = readFileSync(path, 'utf8')
  if (!/^\.\.?[\\/][^\r\n]+\r?\n?$/u.test(text)) return text
  const entry = execFileSync('git', ['ls-files', '--stage', '--', file], { cwd: root, encoding: 'utf8' })
  if (!entry.startsWith('120000 ')) return text
  const target = resolve(dirname(path), text.trim())
  if (relative(root, target).startsWith('..')) throw new Error(`Config link escapes repository: ${file}`)
  return readFileSync(target, 'utf8')
}

/**
 * Return repository-relative Cordis Loader YAML paths under `root`.
 *
 * Translation consistency records are YAML sidecars, never Loader inputs.
 *
 * @param root Repository root to scan.
 * @returns Sorted repository-relative Loader configuration paths.
 */
export function cordisConfigFiles(root: string): string[] {
  return globSync(['**/*cordis*.yml', '**/*cordis*.yaml'], {
    cwd: root,
    exclude: ['.claude/**', 'node_modules/**', 'vendor/**', '**/*.i18n.yaml'],
  }).sort()
}
