/**
 * Enforce MIT declarations for DSH packages and the exact ACP child research-license publication.
 * @module rsh/Scripts/verify-dsh-package-licenses
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const DSH_PACKAGE_NAME = /^@deepseek-ai\/dsh(?:-|$)/
const RESEARCH_LICENSE_PACKAGE = {
  manifestPath: 'rsh/Modules/Official/subagent/acp-child/package.json',
  name: '@deepseek-ai/dsh-acp-child',
  license: 'SEE LICENSE IN LICENSE-REDSPARK-RESEARCH.txt',
  file: 'LICENSE-REDSPARK-RESEARCH.txt',
}
const ROOT_RESEARCH_LICENSE = 'LICENSE-REDSPARK-RESEARCH.txt'

/** Result of checking every DSH package reachable through the root workspace list. */
export interface DshPackageLicenseReport {
  /** Number of DSH package manifests checked. */
  packageCount: number
  /** Repository-relative diagnostics for package-license policy violations. */
  failures: string[]
}

function readManifest(root: string, file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`verify-dsh-package-licenses: ${file} must contain a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string')
}

function workspaceManifestPaths(root: string): string[] {
  const rootManifest = readManifest(root, 'package.json')
  const workspaces = rootManifest.workspaces
  if (!isStringArray(workspaces)) {
    throw new Error('verify-dsh-package-licenses: package.json workspaces must be a string array.')
  }

  const files = new Set(['package.json'])
  for (const pattern of workspaces) {
    for (const file of globSync(`${pattern}/package.json`, { cwd: root })) {
      files.add(file)
    }
  }
  for (const file of globSync('rsh/**/package.json', {
    cwd: root,
    exclude: ['**/node_modules/**'],
  })) {
    files.add(file)
  }
  return [...files].sort()
}

function printable(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value)
}

/**
 * Check every DSH npm package declared by the repository workspace.
 * @param root - absolute repository root containing the workspace package.json.
 * @returns the checked package count and every package-license policy violation.
 */
export function inspectDshPackageLicenses(root: string): DshPackageLicenseReport {
  let packageCount = 0
  const failures: string[] = []

  for (const file of workspaceManifestPaths(root)) {
    const manifest = readManifest(root, file)
    // The private root manifest describes the repository license, not a published DSH package.
    if (file === 'package.json') continue
    const normalizedFile = file.split(sep).join('/')
    const name = manifest.name
    const isDshPackage = typeof name === 'string' && DSH_PACKAGE_NAME.test(name)
    const isResearchLicensePath = normalizedFile === RESEARCH_LICENSE_PACKAGE.manifestPath

    if (isResearchLicensePath) {
      if (isDshPackage) packageCount++
      if (name !== RESEARCH_LICENSE_PACKAGE.name) {
        failures.push(
          `${normalizedFile}: expected package name ${RESEARCH_LICENSE_PACKAGE.name}; found ${printable(name)}.`,
        )
        continue
      }

      if (manifest.license !== RESEARCH_LICENSE_PACKAGE.license) {
        failures.push(
          `${normalizedFile}: ${RESEARCH_LICENSE_PACKAGE.name} must declare "license": `
          + `${JSON.stringify(RESEARCH_LICENSE_PACKAGE.license)}; found ${printable(manifest.license)}.`,
        )
      }
      if (!isStringArray(manifest.files) || !manifest.files.includes(RESEARCH_LICENSE_PACKAGE.file)) {
        failures.push(
          `${normalizedFile}: ${RESEARCH_LICENSE_PACKAGE.name} must include `
          + `${JSON.stringify(RESEARCH_LICENSE_PACKAGE.file)} in "files".`,
        )
      }

      const rootLicensePath = resolve(root, ROOT_RESEARCH_LICENSE)
      const packageLicensePath = resolve(root, dirname(file), RESEARCH_LICENSE_PACKAGE.file)
      if (!existsSync(rootLicensePath)) {
        failures.push(`${normalizedFile}: missing repository license ${ROOT_RESEARCH_LICENSE}.`)
      }
      if (!existsSync(packageLicensePath)) {
        failures.push(`${normalizedFile}: missing package license ${RESEARCH_LICENSE_PACKAGE.file}.`)
      } else if (existsSync(rootLicensePath)
        && !readFileSync(packageLicensePath).equals(readFileSync(rootLicensePath))) {
        failures.push(
          `${normalizedFile}: package license ${RESEARCH_LICENSE_PACKAGE.file} `
          + `must match repository ${ROOT_RESEARCH_LICENSE}.`,
        )
      }
      continue
    }

    if (!isDshPackage) continue
    packageCount++
    if (manifest.license !== 'MIT') {
      failures.push(
        `${normalizedFile}: ${name} must declare "license": "MIT"; found ${printable(manifest.license)}.`,
      )
    }
  }

  return { packageCount, failures }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const report = inspectDshPackageLicenses(ROOT)
  if (report.failures.length > 0) {
    process.stderr.write('verify-dsh-package-licenses: package-license policy violations found:\n')
    for (const failure of report.failures) process.stderr.write(`  ${failure}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `verify-dsh-package-licenses: ${String(report.packageCount)} DSH package(s) checked; package-license policy satisfied.\n`,
    )
  }
}
