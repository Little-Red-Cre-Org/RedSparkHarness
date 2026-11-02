import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertClientBuildEnvironment,
  clientBuildEnvironmentDefines,
  clientBuildProcessEnvironment,
  officialClientBuildEnvironment,
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  repositoryCommitHash,
  repositoryGitDirty,
  repositoryVersion,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { clientBundle } from '../Programs/Web/client/tsdown.client.ts'

const root = resolve(import.meta.dirname, '..', '..')
const PROBE_NAME = 'RSH_CLIENT_BUILD_TEST'
const COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567'
const PROBE_KEY = `process.env.${PROBE_NAME}`
const originalProbe = process.env[PROBE_NAME]
const roots: string[] = []
const dshBuildWorkflows = [
  'build-exe-for-python-sdk.yml',
  'ci.yml',
  'e2b-e2e.yml',
  'e2e.yml',
  'release.yml',
  'release-publish.yml',
  'sandbox.yml',
]

afterEach(() => {
  if (originalProbe === undefined) Reflect.deleteProperty(process.env, PROBE_NAME)
  else process.env[PROBE_NAME] = originalProbe
  vi.resetModules()
  for (const fixtureRoot of roots.splice(0)) rmSync(fixtureRoot, { recursive: true, force: true })
})

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-client-build-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'rsh/Programs/Web/application/dist/index.html'), '<main></main>')
  write(join(fixtureRoot, 'rsh/Compatibility/DSH/web/frontend/dist/index.html'), '<main></main>')
  write(join(fixtureRoot, 'rsh/Programs/Web/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(fixtureRoot, environment)
  return fixtureRoot
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function repositoryFixture(version = '1.2.3-rc.4'): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-client-build-repository-'))
  roots.push(fixtureRoot)
  write(join(fixtureRoot, 'package.json'), `${JSON.stringify({ version })}\n`)
  write(join(fixtureRoot, 'tracked.txt'), 'committed\n')
  git(fixtureRoot, ['init'])
  git(fixtureRoot, ['config', 'user.name', 'DSH test'])
  git(fixtureRoot, ['config', 'user.email', 'dsh-test@example.invalid'])
  git(fixtureRoot, ['config', 'commit.gpgsign', 'false'])
  git(fixtureRoot, ['add', 'package.json', 'tracked.txt'])
  git(fixtureRoot, ['commit', '-m', 'fixture'])
  return fixtureRoot
}

describe('client build environment', () => {
  it('requires an exact public environment for a named artifact profile', () => {
    const expected = {
      RSH_CLIENT_BUILD_PROFILE: 'official',
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_TITLE: 'RedSpark Harness',
      RSH_CLIENT_VERSION: '1.2.3',
    } as const

    expect(() => { assertClientBuildEnvironment({ PATH: '/bin', ...expected }, expected) }).not.toThrow()
    expect(() => { assertClientBuildEnvironment({}, expected) }).toThrow(/RSH_CLIENT_TITLE/)
    expect(() => { assertClientBuildEnvironment({ RSH_CLIENT_TITLE: 'Other' }, expected) }).toThrow(/RSH_CLIENT_TITLE/)
    expect(() => {
      assertClientBuildEnvironment({ ...expected, RSH_CLIENT_UNDECLARED: 'value' }, expected)
    }).toThrow(/RSH_CLIENT_UNDECLARED/)
  })

  it('inherits public values by default and isolates an explicit official profile', () => {
    const parent = {
      PATH: '/bin',
      RSH_BUILD_CLIENT_PROFILE: 'official',
      RSH_CLIENT_BUILD_PROFILE: 'local',
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_GIT_DIRTY: 'true',
      RSH_CLIENT_TITLE: 'Local title',
      RSH_CLIENT_VERSION: '1.2.3',
      RSH_CLIENT_EXTRA: 'local-extra',
    }

    expect(resolveClientBuildEnvironment({ RSH_CLIENT_TITLE: 'Local title' })).toEqual({
      RSH_CLIENT_TITLE: 'Local title',
    })
    expect(resolveClientBuildEnvironment(parent)).toEqual({
      RSH_CLIENT_BUILD_PROFILE: 'official',
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_TITLE: 'RedSpark Harness',
      RSH_CLIENT_VERSION: '1.2.3',
    })
    expect(() => {
      resolveClientBuildEnvironment({ RSH_BUILD_CLIENT_PROFILE: 'official' })
    }).toThrow(/RSH_CLIENT_COMMIT_HASH/)
    expect(() => {
      resolveClientBuildEnvironment({
        RSH_BUILD_CLIENT_PROFILE: 'official',
        RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      })
    }).toThrow(/RSH_CLIENT_VERSION/)
    expect(() => { resolveClientBuildEnvironment({}, 'unknown') }).toThrow(/unknown client build profile/)
    expect(clientBuildProcessEnvironment(parent, {
      RSH_CLIENT_BUILD_PROFILE: 'official',
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_TITLE: 'RedSpark Harness',
      RSH_CLIENT_VERSION: '1.2.3',
    })).toEqual({
      PATH: '/bin',
      RSH_CLIENT_BUILD_PROFILE: 'official',
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_TITLE: 'RedSpark Harness',
      RSH_CLIENT_VERSION: '1.2.3',
    })
    expect(repositoryCommitHash('/unused', { RSH_CLIENT_COMMIT_HASH: COMMIT_HASH })).toBe(COMMIT_HASH.slice(0, 7))
  })

  it('owns repository version, commit, and dirty metadata for complete builds', () => {
    const fixtureRoot = repositoryFixture()
    const commit = git(fixtureRoot, ['rev-parse', '--short=7', 'HEAD'])

    expect(repositoryVersion(fixtureRoot)).toBe('1.2.3-rc.4')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
      RSH_CLIENT_EXTRA: 'preserved',
      RSH_CLIENT_GIT_DIRTY: 'true',
      RSH_CLIENT_VERSION: 'spoofed',
    })).toEqual({
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_EXTRA: 'preserved',
      RSH_CLIENT_VERSION: '1.2.3-rc.4',
    })
    expect(officialClientBuildEnvironment(fixtureRoot)).toEqual({
      RSH_CLIENT_BUILD_PROFILE: 'official',
      RSH_CLIENT_COMMIT_HASH: commit,
      RSH_CLIENT_TITLE: 'RedSpark Harness',
      RSH_CLIENT_VERSION: '1.2.3-rc.4',
    })

    write(join(fixtureRoot, '.gitignore'), 'ignored.txt\n')
    git(fixtureRoot, ['add', '.gitignore'])
    git(fixtureRoot, ['commit', '-m', 'ignore fixture'])
    write(join(fixtureRoot, 'ignored.txt'), 'ignored\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    rmSync(join(fixtureRoot, 'ignored.txt'))

    write(join(fixtureRoot, 'tracked.txt'), 'unstaged\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    write(join(fixtureRoot, 'tracked.txt'), 'committed\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)

    write(join(fixtureRoot, 'tracked.txt'), 'staged\n')
    git(fixtureRoot, ['add', 'tracked.txt'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    git(fixtureRoot, ['commit', '-m', 'staged fixture'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)

    write(join(fixtureRoot, 'untracked.txt'), 'untracked\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
    })).toEqual({
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_GIT_DIRTY: 'true',
      RSH_CLIENT_VERSION: '1.2.3-rc.4',
    })

    rmSync(join(fixtureRoot, 'untracked.txt'))
    const submoduleSource = repositoryFixture('9.8.7')
    git(fixtureRoot, ['-c', 'protocol.file.allow=always', 'submodule', 'add', submoduleSource, 'submodule'])
    git(fixtureRoot, ['commit', '-am', 'submodule fixture'])
    expect(repositoryGitDirty(fixtureRoot)).toBe(false)
    write(join(fixtureRoot, 'submodule/tracked.txt'), 'modified submodule\n')
    expect(repositoryGitDirty(fixtureRoot)).toBe(true)
  })

  it('omits dirty metadata when repository metadata is unavailable', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-client-build-no-git-'))
    roots.push(fixtureRoot)
    write(join(fixtureRoot, 'package.json'), '{"version":"2.0.0"}\n')

    expect(repositoryGitDirty(fixtureRoot)).toBeUndefined()
    expect(repositoryClientBuildEnvironment(fixtureRoot, {
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH,
      RSH_CLIENT_GIT_DIRTY: 'true',
    })).toEqual({
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_VERSION: '2.0.0',
    })
  })

  it('defines only public client values over a non-enumerable fallback', () => {
    expect(clientBuildEnvironmentDefines({
      PATH: '/bin',
      RSH_TEST_API_KEY: 'secret',
      RSH_CLIENT_VARIANT: 'quoted "value"',
      RSH_CLIENT_EMPTY: '',
      RSH_CLIENT_UNSET: undefined,
    })).toEqual({
      'process.env': '{}',
      'process.env.RSH_CLIENT_EMPTY': '""',
      'process.env.RSH_CLIENT_VARIANT': '"quoted \\"value\\""',
    })
  })

  it('feeds the same build-process value to dynamic tsdown bundles and the Vite shell', async () => {
    process.env[PROBE_NAME] = 'shared-value'

    const configs = clientBundle('@redspark/rsh-client-ui-sidebar', [
      'lib/types/index.js',
      'lib/types/invariant.js',
    ])({ env: { RSH_BUILD_FACE: 'client' } })
    if (!Array.isArray(configs)) throw new TypeError('client bundle config must be an array')
    const dynamic = configs.find(config => config.name === '@redspark/rsh-client-ui-sidebar/client')
    expect(dynamic?.define).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })

    const viteConfigPath = '../Programs/Web/application/vite.config.ts'
    const viteModule: unknown = await import(viteConfigPath)
    if (typeof viteModule !== 'object' || viteModule === null) {
      throw new TypeError('web Vite config module must be an object')
    }
    const configureVite: unknown = Reflect.get(viteModule, 'createWebViteConfig')
    if (typeof configureVite !== 'function') throw new TypeError('web Vite config factory must be a function')
    const viteConfig: unknown = Reflect.apply(configureVite, undefined, [false])
    if (typeof viteConfig !== 'object' || viteConfig === null) {
      throw new TypeError('web Vite config must be an object')
    }
    expect(Reflect.get(viteConfig, 'define')).toMatchObject({
      'process.env': '{}',
      [PROBE_KEY]: '"shared-value"',
    })
  })

  it('binds the recorded environment to a complete set of client artifacts', () => {
    const officialEnvironment = {
      RSH_CLIENT_BUILD_PROFILE: 'official',
      RSH_CLIENT_COMMIT_HASH: COMMIT_HASH.slice(0, 7),
      RSH_CLIENT_TITLE: 'RedSpark Harness',
      RSH_CLIENT_VERSION: '1.2.3',
    }
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})

    expect(readClientBuildRecord(official, officialEnvironment).environment).toEqual(officialEnvironment)
    expect(() => { readClientBuildRecord(defaultBuild, officialEnvironment) }).toThrow(/RSH_CLIENT_/)
    expect(() => { readClientBuildRecord(join(defaultBuild, 'missing')) }).toThrow(/record.*missing/)

    write(join(official, 'rsh/Compatibility/DSH/web/frontend/dist/index.html'), '<main>changed</main>')
    expect(() => { readClientBuildRecord(official) }).toThrow(/artifacts differ/)
  })

  it('keeps public client values out of workflow-wide environments', () => {
    for (const name of dshBuildWorkflows) {
      const path = `.github/workflows/${name}`
      const document: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
      if (typeof document !== 'object' || document === null || Array.isArray(document)) {
        throw new TypeError(`${path} must contain a workflow object`)
      }
      expect(JSON.stringify(document), path).not.toContain('RSH_CLIENT_')
    }
  })
})
