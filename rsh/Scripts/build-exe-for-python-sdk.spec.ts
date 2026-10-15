import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..')
const script = resolve(root, 'rsh/Scripts/build-exe-for-python-sdk.ts')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('staged Python runtime dsh-tools peer', () => {
  it('coalesces every identical nested copy and preserves one scheduler module instance', () => {
    const fixture = createStagedToolsFixture()
    const result = runStagedToolsProbe(fixture)

    expect(result.status).toBe(0)
    const observation = JSON.parse(result.stdout) as ToolsProbeObservation
    if (observation.kind !== 'coalesced') throw new Error(observation.refusal)
    expect(observation.removed).toBe(2)
    expect(new Set(observation.resolvedToolsUrls).size).toBe(1)
    expect(observation.schedulerKeysMatch).toBe(true)
    expect(observation.prepareResolvesToOwnerFunction).toBe(true)
    expect(existsSync(fixture.agentLoopTools)).toBe(false)
    expect(existsSync(fixture.minimalTools)).toBe(false)
    expect(existsSync(fixture.aliasTools)).toBe(true)
  })

  it.each([
    ['a manifest difference', 'manifest'],
    ['a package-file difference', 'file'],
    ['a different peer resolution', 'peer'],
  ] as const)('refuses to remove nested copies after %s', (_description, mismatch) => {
    const fixture = createStagedToolsFixture(mismatch)
    const result = runStagedToolsProbe(fixture)
    expect(result.status).toBe(0)

    const observation = JSON.parse(result.stdout) as ToolsProbeObservation
    if (observation.kind !== 'refused') throw new Error('expected incompatible staged copies to be refused')
    expect(observation.refusal).toMatch(/refusing to coalesce/)
    expect(existsSync(fixture.agentLoopTools)).toBe(true)
    expect(existsSync(fixture.minimalTools)).toBe(true)
  })
})

function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx/esm', script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: isolatedPnpmEnvironment(env),
  })
}

describe('Python runtime executable builder CLI', () => {
  it('keeps the single-file dispatcher on the Python packaging surface', () => {
    const bootstrapPath = resolve(root, 'rsh/Programs/SDK/python/sdk-runtime/runtime-bootstrap.mjs')
    const bootstrap = readFileSync(bootstrapPath, 'utf8')
    const cliConfig = readFileSync(resolve(root, 'rsh/Programs/CLI/tsdown.config.ts'), 'utf8')
    const cliTsconfig = readFileSync(resolve(root, 'rsh/Programs/CLI/tsconfig.json'), 'utf8')
    const cliManifest = JSON.parse(readFileSync(resolve(root, 'rsh/Programs/CLI/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const runtimeManifest = JSON.parse(readFileSync(resolve(root, 'rsh/Programs/SDK/python/sdk-runtime/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }

    expect(existsSync(resolve(root, 'rsh/Programs/CLI/src/runtime-bootstrap.ts'))).toBe(false)
    expect(cliConfig).not.toContain('runtime-bootstrap')
    expect(cliConfig).toContain("clean: ['lib/*.js']")
    expect(cliTsconfig).not.toContain('rsh/Core/subprocess/subprocess-local')
    expect(cliManifest.dependencies).toHaveProperty('@deepseek-ai/dsh-subprocess-local')
    expect(cliManifest.devDependencies).not.toHaveProperty('@deepseek-ai/dsh-subprocess-local')
    expect(runtimeManifest.dependencies).toHaveProperty('@deepseek-ai/dsh-subprocess-local')
    expect(bootstrap).toContain("import('@deepseek-ai/dsh/lib/bin.js')")
    expect(bootstrap).toContain('await runCli()')
    expect(bootstrap).toContain("import('@deepseek-ai/dsh-subprocess-local/runner')")
    expect(bootstrap).toContain('await runSelectedSubprocessRunner(selection)')
  })

  it('runs pnpm through its JavaScript entrypoint without a command shell', () => {
    const result = run(
      { npm_execpath: 'C:\\tools\\pnpm.cjs' },
      '--skip-build',
      '--dry-run',
      '--targets=node24-macos-arm64',
    )

    expect(result.status).toBe(0)
    const nodeCommand = process.execPath.includes(' ') ? JSON.stringify(process.execPath) : process.execPath
    expect(result.stdout).toContain(`${nodeCommand} C:\\tools\\pnpm.cjs run verify-runtime-closure`)
    expect(result.stdout).toContain(`${nodeCommand} C:\\tools\\pnpm.cjs --filter dsh-python-runtime-closure deploy`)
    const deploy = result.stdout.split('\n').find(line => line.includes(' --filter dsh-python-runtime-closure deploy'))
    expect(deploy).toContain('--prod --config.allow-unused-patches=true')
    expect(result.stdout.split('--config.allow-unused-patches=true')).toHaveLength(2)
    expect(result.stdout).not.toContain(resolve(root, 'rsh/Programs/SDK/python/sdk-runtime/runtime-bootstrap.mjs'))
    expect(result.stdout).toContain('"bin":"runtime-bootstrap.mjs"')
    expect(result.stdout).toContain('"node_modules/**/*.exe"')
    expect(result.stdout).toContain('"node_modules/**/bin/*"')
    const packager = createRequire(import.meta.url).resolve('@yao-pkg/pkg/lib-es5/bin.js')
    const packagerArgument = packager.includes(' ') ? JSON.stringify(packager) : packager
    expect(result.stdout).toContain(`${nodeCommand} ${packagerArgument}`)
    expect(result.stdout).not.toContain('pnpm.cjs exec pkg')
    expect(result.stdout).not.toMatch(/pnpm\.cmd/i)
  })

  it('resolves the pnpm package behind a Windows command shim', () => {
    const setup = mkdtempSync(join(tmpdir(), 'dsh-pnpm-home-'))
    temporaryDirectories.push(setup)
    const home = join(setup, 'node_modules', '.bin')
    const entrypoint = join(setup, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    mkdirSync(home, { recursive: true })
    mkdirSync(dirname(entrypoint), { recursive: true })
    writeFileSync(entrypoint, '')

    const result = run(
      { npm_execpath: 'C:\\tools\\pnpm.cmd', PNPM_HOME: home },
      '--skip-build',
      '--dry-run',
      '--targets=node24-macos-arm64',
    )

    expect(result.status).toBe(0)
    const nodeCommand = process.execPath.includes(' ') ? JSON.stringify(process.execPath) : process.execPath
    const pnpmCommand = entrypoint.includes(' ') ? JSON.stringify(entrypoint) : entrypoint
    expect(result.stdout).toContain(`${nodeCommand} ${pnpmCommand} run verify-runtime-closure`)
    expect(result.stdout).not.toMatch(/pnpm\.cmd/i)
  })

  it('accepts the macOS x64 pkg target', () => {
    const result = run(
      { npm_execpath: 'C:\\tools\\pnpm.cjs' },
      '--skip-build',
      '--dry-run',
      '--targets=node24-macos-x64',
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('lib-es5')
    expect(result.stdout).toContain('--sea --targets node24-macos-x64')
  })

  it('rejects a Windows arm64 product before any build step', () => {
    const result = run(
      { npm_execpath: 'C:\\tools\\pnpm.cjs' },
      '--skip-build',
      '--dry-run',
      '--targets=node24-win-arm64',
    )

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Windows supports x64 only')
    expect(result.stdout).toBe('')
  })
})

function isolatedPnpmEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !['npm_execpath', 'pnpm_home'].includes(key.toLowerCase())),
  )
  return { ...environment, ...overrides }
}

type ToolsFixtureMismatch = 'manifest' | 'file' | 'peer'

type ToolsProbeObservation =
  | {
    kind: 'coalesced'
    removed: number
    resolvedToolsUrls: string[]
    schedulerKeysMatch: boolean
    prepareResolvesToOwnerFunction: boolean
  }
  | { kind: 'refused'; refusal: string }

function runStagedToolsProbe(fixture: ReturnType<typeof createStagedToolsFixture>) {
  const probe = join(fixture.staging, 'probe.mjs')
  const helper = pathToFileURL(resolve(root, 'rsh/Scripts/coalesce-staged-dsh-tools.ts')).href
  writeFileSync(probe, `
import { coalesceStagedDshToolsPeer } from ${JSON.stringify(helper)}
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const staging = process.argv[2]
try {
  const removed = await coalesceStagedDshToolsPeer(staging)
  const rootTools = await import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href)
  const base = await import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-base/lib/index.js')).href)
  const agentLoop = await import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-base/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js')).href)
  const minimal = await import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-sdk-minimal/lib/index.js')).href)
  const prepare = () => undefined
  const tools = { [rootTools.scheduler]: { prepare } }
  process.stdout.write(JSON.stringify({
    kind: 'coalesced',
    removed,
    resolvedToolsUrls: [rootTools.resolvedToolsUrl, base.resolvedToolsUrl, agentLoop.resolvedToolsUrl, minimal.resolvedToolsUrl],
    schedulerKeysMatch: [base.scheduler, agentLoop.scheduler, minimal.scheduler].every(key => key === rootTools.scheduler),
    prepareResolvesToOwnerFunction: [base, agentLoop, minimal].every(consumer => consumer.resolvePrepare(tools) === prepare),
  }))
} catch (error) {
  process.stdout.write(JSON.stringify({ kind: 'refused', refusal: error instanceof Error ? error.message : String(error) }))
}
`)
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'NODE_OPTIONS'))
  return spawnSync(process.execPath, ['--import', 'tsx/esm', probe, fixture.staging], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  })
}

function createStagedToolsFixture(mismatch?: ToolsFixtureMismatch) {
  const staging = mkdtempSync(join(tmpdir(), 'dsh-staged-tools-'))
  temporaryDirectories.push(staging)
  const nodeModules = join(staging, 'node_modules')
  const rootTools = join(nodeModules, '@deepseek-ai', 'dsh-tools')
  const base = join(nodeModules, '@deepseek-ai', 'dsh-base')
  const agentLoop = join(base, 'node_modules', '@deepseek-ai', 'dsh-agent-loop')
  const minimal = join(nodeModules, '@deepseek-ai', 'dsh-sdk-minimal')
  const agentLoopTools = join(agentLoop, 'node_modules', '@deepseek-ai', 'dsh-tools')
  const minimalTools = join(minimal, 'node_modules', '@deepseek-ai', 'dsh-tools')
  const aliasTools = join(nodeModules, '@fixture', 'dsh-tools')
  const toolsManifest = {
    name: '@deepseek-ai/dsh-tools',
    version: '0.1.5',
    type: 'module',
    exports: { '.': './lib/index.js' },
    peerDependencies: mismatch === 'peer' ? { '@deepseek-ai/dsh-context': 'workspace:^' } : {},
  }
  writePackage(staging, {
    name: 'dsh-python-runtime-closure',
    dependencies: { '@deepseek-ai/dsh-tools': 'workspace:^' },
  })
  writeFileSync(join(staging, 'runtime-bootstrap.mjs'), "import '@deepseek-ai/dsh-tools'\n")
  writePackage(rootTools, toolsManifest, { 'lib/index.js': "export const scheduler = Symbol('scheduler'); export const resolvedToolsUrl = import.meta.url\n" })

  const consumerEntry = "import { scheduler } from '@deepseek-ai/dsh-tools'; export { scheduler }; export const resolvedToolsUrl = import.meta.resolve('@deepseek-ai/dsh-tools'); export const resolvePrepare = tools => tools[scheduler]?.prepare\n"
  writeConsumer(base, '@deepseek-ai/dsh-base', consumerEntry)
  writeConsumer(agentLoop, '@deepseek-ai/dsh-agent-loop', consumerEntry, true)
  writeConsumer(minimal, '@deepseek-ai/dsh-sdk-minimal', consumerEntry)

  const nestedManifest = { ...toolsManifest, exports: mismatch === 'manifest' ? { '.': './lib/missing.js' } : toolsManifest.exports }
  const nestedCode = "export const scheduler = Symbol('scheduler'); export const resolvedToolsUrl = import.meta.url\n"
  writePackage(agentLoopTools, toolsManifest, { 'lib/index.js': nestedCode })
  writePackage(minimalTools, nestedManifest, {
    'lib/index.js': mismatch === 'file' ? "export const scheduler = Symbol('other')\n" : nestedCode,
  })
  writePackage(aliasTools, toolsManifest, { 'lib/index.js': "export const scheduler = Symbol('alias')\n" })
  if (mismatch === 'peer') {
    writePackage(join(nodeModules, '@deepseek-ai', 'dsh-context'), {
      name: '@deepseek-ai/dsh-context',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './index.js' },
    }, { 'index.js': 'export {}\n' })
    writePackage(join(minimal, 'node_modules', '@deepseek-ai', 'dsh-context'), {
      name: '@deepseek-ai/dsh-context',
      version: '2.0.0',
      type: 'module',
      exports: { '.': './index.js' },
    }, { 'index.js': 'export {}\n' })
  }

  return { staging, agentLoopTools, minimalTools, aliasTools }
}

function writeConsumer(directory: string, name: string, entry: string, peer = false): void {
  writePackage(directory, {
    name,
    version: '0.1.5',
    type: 'module',
    dependencies: peer ? {} : { '@deepseek-ai/dsh-tools': 'workspace:^' },
    peerDependencies: peer ? { '@deepseek-ai/dsh-tools': 'workspace:^' } : {},
    exports: { '.': './lib/index.js' },
  }, { 'lib/index.js': entry })
}

function writePackage(directory: string, manifest: unknown, files: Record<string, string> = {}): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [path, content] of Object.entries(files)) {
    const file = join(directory, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
}
