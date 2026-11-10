/**
 * Native scenario assembly shared by recorded-session replays.
 *
 * Every Native scenario repeats the same setup: an isolated Harness home, a
 * profile that resolves the shipped composition with the scenario's own rows,
 * module links for the packages the profile reaches, and one child process
 * launched with the Cordis-context probe. This module owns that sequence so a
 * scenario states only what makes it different.
 *
 * @module @redspark/rsh-session-snapshot/native-scenario
 */

import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'

/** One module the launched profile resolves by name. */
export interface NativeScenarioModule {
  /** Package name as it appears in `node_modules`. */
  readonly name: string
  /** Repository-relative package directory the link points at. */
  readonly path: string
}

/** One row of a Native profile composition, as the profile file spells it. */
export interface NativeScenarioRow {
  readonly id: string
  readonly plugin?: string
  readonly scope?: string
  readonly config?: Record<string, unknown>
  readonly disabled?: boolean
}

/** Inputs one recorded-session Native scenario supplies. */
export interface NativeScenarioOptions {
  /** Absolute repository root. */
  readonly root: string
  /** Directory holding the scenario's committed fixtures. */
  readonly scene: string
  /** Child process working directory name inside the isolated home. */
  readonly workspaceName?: string
  /** Files copied into the workspace before launch, keyed by scenario-relative source. */
  readonly workspaceFiles?: Readonly<Record<string, string>>
  /** Modules the launched profile must resolve, beyond the shipped baseline. */
  readonly modules?: readonly NativeScenarioModule[]
  /** Rewrite one shipped composition row; returning the row keeps it unchanged. */
  readonly composeRow?: (row: NativeScenarioRow, paths: NativeScenarioPaths) => NativeScenarioRow
  /** Rows appended after the shipped composition. */
  readonly extraRows?: (paths: NativeScenarioPaths) => readonly NativeScenarioRow[]
  /** Package the `model` row is replaced with, plus its installation config. */
  readonly model?: { readonly plugin: string; readonly config: Record<string, unknown> }
  /** Additional `node_modules` packages materialized from source text. */
  readonly localPackages?: readonly { readonly name: string; readonly files: Readonly<Record<string, string>> }[]
  /**
   * Contiguous child-generation fixture files, in role order.
   *
   * A scenario that records a child Session replays each child from its own script;
   * the replay Provider consumes these positionally, so order is the role order.
   */
  readonly childFixtures?: readonly string[]
}

/** Resolved directories one scenario reads and writes. */
export interface NativeScenarioPaths {
  readonly home: string
  readonly profile: string
  readonly modules: string
  readonly workspace: string
  readonly sessions: string
}

/** Launch options a scenario may vary per run. */
export interface NativeScenarioRunOptions {
  /** Extra child environment on top of the isolated home. */
  readonly env?: Record<string, string>
  /** Process deadline; a run that exceeds it rejects. */
  readonly timeoutMs?: number
}

/** One assembled scenario, ready to launch and inspect. */
export interface NativeScenario {
  readonly paths: NativeScenarioPaths
  /** Launch the shipped `native-headless` profile with the given task. */
  run(task: string, options?: NativeScenarioRunOptions): Promise<{ stdout: string; stderr: string }>
  /** Remove every directory this scenario created. */
  dispose(): void
}

/** The modules every shipped Native headless profile reaches. */
const BASELINE_MODULES: readonly NativeScenarioModule[] = [
  { name: 'rsh-native-headless', path: 'rsh/Engine/core/native-headless' },
  { name: 'rsh-native-agent', path: 'rsh/Engine/core/native-agent' },
  { name: 'rsh-native-tools', path: 'rsh/Engine/core/native-tools' },
  { name: 'rsh-native-model-execution', path: 'rsh/Engine/core/native-model-execution' },
  { name: 'rsh-session-persistence-jsonl', path: 'rsh/Engine/session/session-persistence-jsonl' },
  { name: 'rsh-fs-local', path: 'rsh/Modules/Official/fs/fs-local' },
  { name: 'rsh-fs-observation-policy', path: 'rsh/Modules/Official/fs/fs-observation-policy' },
  { name: 'rsh-llm', path: 'rsh/Engine/llm/llm' },
  { name: 'rsh-native-runtime', path: 'rsh/Core/runtime-diagnostics/native-runtime' },
]

/**
 * Assemble one Native scenario in an isolated Harness home.
 *
 * The profile starts from the shipped `native-headless` composition, so a
 * scenario inherits the real product rows and states only its differences. The
 * child process launches through `dsh --profile` with the Cordis-context probe,
 * which fails the run if any Cordis Context is constructed.
 * @param options - scenario identity, fixture directory, and composition overrides.
 * @returns the assembled scenario with launch and cleanup handles.
 */
export function assembleNativeScenario(options: NativeScenarioOptions): NativeScenario {
  const home = mkdtempSync(join(tmpdir(), 'native-scenario-'))
  const paths: NativeScenarioPaths = {
    home,
    profile: join(home, 'profiles', 'native-headless'),
    modules: join(home, 'profiles', 'native-headless', 'node_modules', '@redspark'),
    workspace: join(home, options.workspaceName ?? 'work'),
    sessions: join(home, 'sessions'),
  }
  mkdirSync(paths.workspace, { recursive: true })
  mkdirSync(paths.modules, { recursive: true })
  mkdirSync(paths.profile, { recursive: true })

  const shipped = join(options.root, 'rsh/Programs/CLI/tests/profiles/native-headless')
  copyFileSync(join(shipped, 'package.json'), join(paths.profile, 'package.json'))

  for (const [source, target] of Object.entries(options.workspaceFiles ?? {})) {
    const destination = join(paths.workspace, target)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(join(options.scene, source), destination)
  }

  for (const module of [...BASELINE_MODULES, ...options.modules ?? []]) {
    symlinkSync(join(options.root, module.path), join(paths.modules, module.name), 'junction')
  }
  for (const local of options.localPackages ?? []) {
    const directory = join(paths.profile, 'node_modules', local.name)
    mkdirSync(directory, { recursive: true })
    for (const [file, content] of Object.entries(local.files)) writeFileSync(join(directory, file), content)
  }

  const composition = JSON.parse(readFileSync(join(shipped, 'rsh.profile.json'), 'utf8')) as { installations: NativeScenarioRow[] }
  const rows = composition.installations.map((row) => {
    if (row.id === 'storage') return { ...row, config: { root: paths.sessions, compression: 'none' } }
    if (row.id === 'fs') return { ...row, config: { cwd: paths.workspace } }
    if (row.id === 'model' && options.model !== undefined) {
      return { ...row, plugin: options.model.plugin, config: options.model.config }
    }
    return options.composeRow?.(row, paths) ?? row
  })
  composition.installations = [...rows, ...options.extraRows?.(paths) ?? []]
  writeFileSync(join(paths.profile, 'rsh.profile.json'), JSON.stringify(composition))

  const probe = pathToFileURL(join(options.root, 'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href
  return {
    paths,
    async run(task, runOptions = {}) {
      const child = await execa(process.execPath, [
        '--import', probe,
        join(options.root, 'rsh/Programs/CLI/lib/bin.js'),
        '--profile', 'native-headless', task,
      ], {
        env: {
          ...process.env, RSH_HOME: paths.home,
          // The replay Provider consumes child scripts positionally, in role order.
          ...options.childFixtures === undefined || options.childFixtures.length === 0
            ? {} : { RSH_SNAPSHOT_CHILD_FILES: options.childFixtures.join(delimiter) },
          ...runOptions.env ?? {},
        },
        reject: false,
        timeout: runOptions.timeoutMs ?? 30_000,
      })
      if (child.exitCode !== 0) {
        throw new Error('native scenario exited ' + String(child.exitCode) + ': ' + child.stderr)
      }
      return { stdout: child.stdout, stderr: child.stderr }
    },
    dispose() { rmSync(home, { recursive: true, force: true }) },
  }
}

/**
 * Build a `node_modules` package that re-exports a built `./native` entry from one repository package.
 *
 * A profile resolves its rows by package name, so installing a scenario-only
 * provider means materializing a package rather than editing the shipped profile.
 * @param name - package name the profile row refers to.
 * @param target - module specifier the generated entry re-exports from.
 * @returns the package name and the files to write under it.
 */
export function reexportPackage(name: string, target: string): { name: string; files: Record<string, string> } {
  return {
    name,
    files: {
      'package.json': JSON.stringify({
        name, version: '0.0.0', type: 'module',
        exports: { './native': './native.mjs', './package.json': './package.json' },
        dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
      }),
      'native.mjs': "export { plugin } from '" + target + "'\n",
    },
  }
}

/**
 * Resolve the repository root from a scenario file's own module URL.
 * @param importMetaUrl - the calling module's `import.meta.url`.
 * @param depth - directory levels between that module and the repository root.
 * @returns the absolute repository root with a trailing separator.
 */
export function repositoryRoot(importMetaUrl: string, depth: number): string {
  return fileURLToPath(new URL('../'.repeat(depth), importMetaUrl))
}
