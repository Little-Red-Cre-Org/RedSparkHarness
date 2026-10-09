/**
 * Enforce dsh profiles as the only supported Node application launcher.
 * Vendor CLIs, build tools, and test tools are explicit classifications
 * rather than implicit holes.
 */

import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WORKSPACE_MANIFEST_GLOBS } from './workspace-manifest-globs.ts'

type ManifestBin = string | Record<string, string>

interface PackageManifest {
  readonly bin?: unknown
}

interface RootManifest {
  readonly scripts?: Record<string, unknown>
}

interface DemoPolicy {
  readonly kind: 'dsh-direct' | 'dsh-wrapper'
  readonly wrapper?: string
}

/** Public product launcher plus the private build-only WebWorker packer. */
const MANIFEST_BIN_ALLOWLIST = new Map<string, ManifestBin>([
  ['rsh/Programs/CLI/package.json', { dsh: 'lib/bin.js' }],
  ['rsh/Modules/Community/experimental/webworker-packer/package.json', { 'dsh-pack-vfs-image': './bin.js' }],
])

/** Every JavaScript executable in an application or packaging workspace has one explicit role. */
const EXECUTABLE_SOURCE_ALLOWLIST = new Map<string, string>([
  ['rsh/Programs/CLI/src/bin.ts', 'supported dsh application launcher'],
  ['rsh/Engine/context/time-context/tests/fixtures/driver.ts', 'test-only subprocess driver'],
  ['rsh/Modules/Community/experimental/webworker-packer/bin.js', 'private build-only wrapper'],
  ['rsh/Modules/Community/experimental/webworker-packer/src/bin.ts', 'private build-only implementation'],
  ['rsh/Programs/SDK/packages/client/tests/fake-runtime.ts', 'test-only SDK runtime peer'],
  ['rsh/Engine/session/session-telemetry-otel/tests/fixtures/driver.ts', 'test-only subprocess driver'],
  ['rsh/Modules/Official/shell/tool-pwsh/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['rsh/Engine/subagent/subagent-acp/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['rsh/Engine/subagent/subagent-claude-code/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['rsh/Compatibility/DSH/bridge/subagent-codex/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['rsh/Compatibility/DSH/subagent/subagent-dsh-sdk/tests/fixtures/loader/driver.ts', 'test-only subprocess driver'],
  ['rsh/Tests/test-support/loader-smoke/tests/fixtures/headless-driver.ts', 'test-only subprocess driver'],
  ['rsh/Tests/test-support/llm-mock-server/src/bin.ts', 'test-only model server'],
  ['rsh/Programs/SDK/python/sdk-runtime/runtime-bootstrap.mjs', 'private packaging-only runtime dispatcher'],
])

/** Root demos are application wrappers and therefore must visibly select dsh. */
const ROOT_DEMO_POLICIES = new Map<string, DemoPolicy>([
  ['demo:ptc', { kind: 'dsh-wrapper', wrapper: 'rsh/Scripts/demo-ptc.mjs' }],
  ['demo:inspector', { kind: 'dsh-direct' }],
])

const SOURCE_PATTERNS = [
  '*.ts',
  '*.js',
  '*.mjs',
  '*.cjs',
  'rsh/Core/**/*.ts',
  'rsh/Core/**/*.js',
  'rsh/Core/**/*.mjs',
  'rsh/Core/**/*.cjs',
  'rsh/Engine/**/*.ts',
  'rsh/Engine/**/*.js',
  'rsh/Engine/**/*.mjs',
  'rsh/Engine/**/*.cjs',
  'rsh/Modules/**/*.ts',
  'rsh/Modules/**/*.js',
  'rsh/Modules/**/*.mjs',
  'rsh/Modules/**/*.cjs',
  'rsh/Compatibility/**/*.ts',
  'rsh/Compatibility/**/*.js',
  'rsh/Compatibility/**/*.mjs',
  'rsh/Compatibility/**/*.cjs',
  'rsh/Programs/**/*.ts',
  'rsh/Programs/**/*.js',
  'rsh/Programs/**/*.mjs',
  'rsh/Programs/**/*.cjs',
  'rsh/Tests/**/*.ts',
  'rsh/Tests/**/*.js',
  'rsh/Tests/**/*.mjs',
  'rsh/Tests/**/*.cjs',
  'rsh/Programs/SDK/python/sdk-runtime/*.mjs',
  'rsh/*/*/src/**/*.ts',
  'rsh/*/*/src/**/*.js',
  'rsh/*/*/src/**/*.mjs',
  'rsh/*/*/src/**/*.cjs',
]

const SOURCE_EXCLUDES = [
  'rsh/Programs/SDK/python/sdk-runtime/src/deepseek_harness_runtime/runtime/**',
  '**/node_modules/**',
  '**/lib/**',
  '**/dist/**',
  '**/coverage/**',
  '**/Core/native/**',
  '**/Core/vendor/**',
]

/** Convert a host path from glob output to the repository's slash form. */
function repositoryPath(path: string): string {
  return path.split(sep).join('/')
}

/** Stable comparison for string and object npm `bin` declarations. */
function normalizedBin(value: unknown): string | undefined {
  if (typeof value === 'string') return JSON.stringify(value)
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (!entries.every(([, target]) => typeof target === 'string')) return undefined
  return JSON.stringify(Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))))
}

function manifestBinViolations(root: string): string[] {
  const failures: string[] = []
  const manifests = [...new Set(globSync([...WORKSPACE_MANIFEST_GLOBS, 'rsh/**/package.json'], {
    cwd: root,
    exclude: ['**/node_modules/**', 'rsh/Programs/SDK/python/sdk-runtime/src/deepseek_harness_runtime/runtime/**'],
  }))]
    .filter(path => !path.replaceAll('\\', '/').startsWith('rsh/Core/vendor/'))
    .sort()
  for (const rawPath of manifests) {
    const path = repositoryPath(rawPath)
    const manifest = JSON.parse(readFileSync(resolve(root, path), 'utf8')) as PackageManifest
    if (manifest.bin === undefined) continue
    const expected = MANIFEST_BIN_ALLOWLIST.get(path)
    if (expected === undefined) {
      failures.push(`${path}: package bin bypasses the dsh launcher; applications use rsh/Programs/CLI profiles`)
      continue
    }
    if (normalizedBin(manifest.bin) !== normalizedBin(expected)) {
      failures.push(`${path}: classified bin must remain ${JSON.stringify(expected)}, got ${JSON.stringify(manifest.bin)}`)
    }
  }
  return failures
}

function executableSourceViolations(root: string): string[] {
  const failures: string[] = []
  for (const rawPath of globSync(SOURCE_PATTERNS, { cwd: root, exclude: SOURCE_EXCLUDES }).sort()) {
    const path = repositoryPath(rawPath)
    const source = readFileSync(resolve(root, path), 'utf8')
    if (!source.startsWith('#!')) continue
    if (!EXECUTABLE_SOURCE_ALLOWLIST.has(path)) {
      failures.push(`${path}: executable source has no application/build/test classification`)
    }
  }
  return failures
}

function referencesDshCli(source: string): boolean {
  return source.includes('rsh/Programs/CLI/src/bin.ts')
}

function referencesPackageEntry(source: string): boolean {
  const matches = source.match(/rsh\/[^/\s'"`]+(?:\/[^/\s'"`]+)*\/(?:src|lib)\/[^\s'"`]+/g) ?? []
  return matches.some(match => match !== 'rsh/Programs/CLI/src/bin.ts')
}

function rootDemoViolations(root: string): string[] {
  const manifestPath = resolve(root, 'package.json')
  if (!existsSync(manifestPath)) return []
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RootManifest
  const failures: string[] = []
  for (const [name, commandValue] of Object.entries(manifest.scripts ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (!name.startsWith('demo:')) continue
    const command = typeof commandValue === 'string' ? commandValue : ''
    const policy = ROOT_DEMO_POLICIES.get(name)
    if (policy === undefined) {
      failures.push(`package.json scripts.${name}: demo launcher has no explicit dsh or in-process classification`)
      continue
    }
    if (policy.kind === 'dsh-direct') {
      if (!referencesDshCli(command)) failures.push(`package.json scripts.${name}: application demo must launch rsh/Programs/CLI/src/bin.ts`)
      if (referencesPackageEntry(command)) failures.push(`package.json scripts.${name}: application demo must not launch a package entry directly`)
      continue
    }
    const wrapper = policy.wrapper
    if (wrapper === undefined || !command.includes(wrapper)) {
      failures.push(`package.json scripts.${name}: classified wrapper must be ${String(wrapper)}`)
      continue
    }
    const wrapperPath = resolve(root, wrapper)
    if (!existsSync(wrapperPath)) {
      failures.push(`${wrapper}: classified demo wrapper is missing`)
      continue
    }
    const source = readFileSync(wrapperPath, 'utf8')
    if (!referencesDshCli(source)) failures.push(`${wrapper}: application demo wrapper must launch rsh/Programs/CLI/src/bin.ts`)
    if (referencesPackageEntry(source)) failures.push(`${wrapper}: application demo wrapper must not launch a package entry directly`)
  }
  return failures
}

/**
 * Find unsupported application entrypoints below a repository root.
 * @param root - repository or test-fixture root.
 * @returns deterministic path-qualified violations.
 */
export function applicationEntrypointViolations(root: string): string[] {
  return [
    ...manifestBinViolations(root),
    ...executableSourceViolations(root),
    ...rootDemoViolations(root),
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..', '..')
  const failures = applicationEntrypointViolations(root)
  if (failures.length > 0) {
    console.error('verify-application-entrypoints: unsupported launcher(s):')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log('verify-application-entrypoints: dsh is the only supported Node application launcher.')
  }
}
