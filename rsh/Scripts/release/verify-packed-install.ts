/**
 * Install packed tarballs into a throwaway consumer outside the repository and
 * drive the installed executable with plain Node.
 *
 * Every repository tarball the installed tree needs comes from `--from`, except
 * the optional native platform packages, which npm takes from the registry with
 * the external dependencies, as a normal install does. That matters beyond hermetic
 * verification: the harness packages declare the vendored framework as a peer,
 * those packages live in another release sequence, and this job must not depend
 * on the registry already carrying versions that match — one pull request may
 * bump both families before either publishes — so a dsh verification passes the
 * vendored family's pack output too, while publishing only its own
 * ([rationale](../../../.agents/notes/implemented/process/2026-08-10-npm-release-sequences.md)).
 *
 * What this proves is that `files` selected a complete payload and that the
 * published dependency ranges resolve. A workspace link or a stale `lib/` in the
 * checkout cannot stand in for a missing file here.
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { execaSync } from 'execa'
import { releaseFamily } from './families.ts'
import { capture, isEntry } from './process.ts'
import { packedIdentity } from './tarball.ts'

/**
 * Environment for the installed artifact: no host Node hooks, no host DeepSeek
 * Harness home, and no ambient npm user agent that would confuse npm.
 * @param consumerRoot - the throwaway consumer directory.
 * @returns The child environment.
 */
function consumerEnvironment(consumerRoot: string): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  environment.DSH_HOME = resolve(consumerRoot, '.dsh')
  environment.DSH_AGENTS_HOME = resolve(consumerRoot, '.agents')
  environment.DSH_TELEMETRY_DISABLED = '1'
  return environment
}

/**
 * Every packed tarball in the given directories, as `file:` dependency entries.
 *
 * The directories are read by their contents rather than a pack order file: a
 * directory here can hold tarballs packed only to satisfy a cross-sequence
 * dependency, which no release order describes.
 * @param directories - absolute directories holding packed tarballs.
 * @returns Package name to tarball file URL, and the version each carries.
 */
function packedDependencies(directories: readonly string[]): Map<string, { url: string; version: string }> {
  const dependencies = new Map<string, { url: string; version: string }>()
  for (const directory of directories) {
    const tarballs = readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()
    if (tarballs.length === 0) throw new Error(`${directory} holds no packed tarball`)
    for (const filename of tarballs) {
      const tarball = join(directory, filename)
      const { name, version } = packedIdentity(tarball)
      dependencies.set(name, { url: pathToFileURL(tarball).href, version })
    }
  }
  return dependencies
}

/** Install every tarball under `--from`, drive the `--family` entry, and optionally run packed e2e. */
function main(): void {
  const { values } = parseArgs({
    options: {
      family: { type: 'string' },
      from: { type: 'string', multiple: true },
      'packed-e2e': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  if (values.family === undefined || values.from === undefined || values.from.length === 0) {
    throw new Error('usage: verify-packed-install.ts --family <dsh|vendor> --from <packed directory> [--from ...] [--packed-e2e]')
  }

  const family = releaseFamily(values.family)
  const entry = family.installedEntry
  if (entry === undefined) {
    if (values['packed-e2e']) throw new Error(`--packed-e2e requires a family with an installed executable; ${family.id} has none`)
    console.log(`release verify-packed-install: family ${family.id} publishes no executable, nothing to drive`)
    return
  }

  const root = process.cwd()
  const packed = packedDependencies(values.from.map(directory => resolve(root, directory)))
  const expected = packed.get(entry.packageName)
  if (expected === undefined) throw new Error(`${entry.packageName} is not among the packed tarballs`)

  // Keep outside /tmp: Linux bwrap hides that install behind tmpfs, and /tmp is a sandbox writable root.
  const consumerRoot = mkdtempSync(join(homedir(), `.dsh-packed-${family.id}-`))
  try {
    writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
      name: `dsh-packed-install-${family.id}`,
      version: '0.0.0',
      private: true,
      dependencies: Object.fromEntries([...packed].map(([name, entryPacked]) => [name, entryPacked.url])),
    }, null, 2)}\n`)

    const environment = consumerEnvironment(consumerRoot)
    console.log(`release verify-packed-install: installing ${String(packed.size)} tarball(s) into ${consumerRoot}`)
    // Install optional platform packages as a consumer does: npm resolves
    // node-addon-system-<platform> and sharp's @img/* packages from the public
    // registry at versions selected by the packed entry and sharp. The
    // node-addon-system family publishes independently through
    // .github/workflows/node-addon-system-release.yml. The Landlock entry
    // remains a plain dsh-sandbox-local dependency, so its tarball is supplied
    // through --from.
    const installArgs = [
      'install',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--loglevel=http',
    ]
    // execa resolves npm.cmd on Windows without re-adding host-only environment variables.
    execaSync('npm', installArgs, {
      cwd: consumerRoot,
      env: environment,
      extendEnv: false,
      stripFinalNewline: false,
    })

    const bin = join(consumerRoot, 'node_modules', ...entry.packageName.split('/'), entry.binPath)
    const version = capture(process.execPath, [bin, '--version'], { cwd: consumerRoot, env: environment })
    if (version !== expected.version) {
      throw new Error(`installed ${entry.packageName} --version reported ${JSON.stringify(version)}, expected ${expected.version}`)
    }
    console.log(`release verify-packed-install: installed ${entry.packageName} reports ${version}`)

    if (values['packed-e2e']) {
      const args = [
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.e2e.config.ts',
        '--reporter=verbose',
        '--no-file-parallelism',
        'rsh/Programs/CLI/tests/profiles/native-headless/tests/packed-jobs.e2e.ts',
        'rsh/Programs/CLI/tests/profiles/native-headless/tests/packed-skills.e2e.ts',
        'rsh/Programs/CLI/tests/profiles/native-headless/tests/packed-scheduled-reminder.e2e.ts',
        'rsh/Programs/CLI/tests/profiles/native-headless/tests/packed-workflow.e2e.ts',
        'rsh/Programs/CLI/tests/profiles/native-headless/tests/packed-code-runtime.e2e.ts',
      ]
      console.log('release verify-packed-install: running packed Jobs, Skills, scheduled-reminder, Workflow, and '
        + 'code-runtime e2e against the installed consumer')
      execaSync('pnpm', args, {
        cwd: root,
        env: {
          DSH_PACKED_DSH_BIN: bin,
          DSH_PACKED_CONSUMER_ROOT: consumerRoot,
        },
        stdio: 'inherit',
      })
    }
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) main()
