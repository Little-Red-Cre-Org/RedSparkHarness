import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dump as stringifyYaml } from 'js-yaml'
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
  it('coalesces identical nested workspace peer components and preserves one scheduler module instance', () => {
    const fixture = createStagedToolsFixture()
    const result = runStagedToolsProbe(fixture)

    expect(result.status).toBe(0)
    const observation = JSON.parse(result.stdout) as ToolsProbeObservation
    if (observation.kind !== 'coalesced') throw new Error(observation.refusal)
    expect(observation.removed).toBe(8)
    expect(Object.values(observation.resolvedModuleUrls).every(urls => new Set(urls).size === 1)).toBe(true)
    expect(observation.schedulerKeysMatch).toBe(true)
    expect(observation.prepareResolvesToOwnerFunction).toBe(true)
    expect(observation.nativeToolsInstancesMatch).toBe(true)
    expect(observation.sessionSchedulerKeysMatch).toBe(true)
    expect(existsSync(fixture.agentLoopTools)).toBe(false)
    expect(existsSync(fixture.minimalTools)).toBe(false)
    expect(existsSync(fixture.agentLoopNativeTools)).toBe(false)
    expect(existsSync(fixture.minimalNativeTools)).toBe(false)
    expect(existsSync(fixture.agentLoopSession)).toBe(false)
    expect(existsSync(fixture.minimalSession)).toBe(false)
    expect(existsSync(fixture.agentLoopContext)).toBe(false)
    expect(existsSync(fixture.minimalContext)).toBe(false)
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
    resolvedModuleUrls: Record<string, string[]>
    schedulerKeysMatch: boolean
    prepareResolvesToOwnerFunction: boolean
    nativeToolsInstancesMatch: boolean
    sessionSchedulerKeysMatch: boolean
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
  const removed = await coalesceStagedDshToolsPeer(staging, process.argv[3])
  const rootTools = await import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js')).href)
  const rootNative = await import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-native-tools/lib/index.js')).href)
  const rootSession = await import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-session/lib/index.js')).href)
  const rootContext = await import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-context/lib/index.js')).href)
  const consumers = await Promise.all([
    import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-base/lib/index.js')).href),
    import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-base/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js')).href),
    import(pathToFileURL(join(staging, 'node_modules/@deepseek-ai/dsh-sdk-minimal/lib/index.js')).href),
  ])
  const prepare = () => undefined
  const tools = { [rootTools.scheduler]: { prepare } }
  process.stdout.write(JSON.stringify({
    kind: 'coalesced',
    removed,
    resolvedModuleUrls: {
      tools: [rootTools.resolvedToolsUrl, ...consumers.map(consumer => consumer.resolvedModuleUrls[0])],
      nativeTools: [rootNative.resolvedNativeToolsUrl, ...consumers.map(consumer => consumer.resolvedModuleUrls[1])],
      session: [rootSession.resolvedSessionUrl, ...consumers.map(consumer => consumer.resolvedModuleUrls[2])],
      context: [rootContext.resolvedContextUrl, ...consumers.map(consumer => consumer.resolvedModuleUrls[3])],
    },
    schedulerKeysMatch: consumers.every(consumer => consumer.scheduler === rootTools.scheduler),
    prepareResolvesToOwnerFunction: consumers.every(consumer => consumer.resolvePrepare(tools) === prepare),
    nativeToolsInstancesMatch: consumers.every(consumer => consumer.sharedInstances[0] === rootNative.nativeTools && consumer.sharedInstances[1] === rootContext.context),
    sessionSchedulerKeysMatch: consumers.every(consumer => consumer.sessionScheduler === rootTools.scheduler && rootNative.nativeTools.getSessionScheduler() === rootSession.getSessionScheduler()),
  }))
} catch (error) {
  process.stdout.write(JSON.stringify({ kind: 'refused', refusal: error instanceof Error ? error.message : String(error) }))
}
`)
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'NODE_OPTIONS'))
  return spawnSync(process.execPath, ['--import', 'tsx/esm', probe, fixture.staging, fixture.workspaceRoot], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  })
}

function createStagedToolsFixture(mismatch?: ToolsFixtureMismatch) {
  const staging = mkdtempSync(join(tmpdir(), 'dsh-staged-tools-'))
  temporaryDirectories.push(staging)
  const workspaceRoot = join(staging, 'workspace')
  const nodeModules = join(staging, 'node_modules')
  const rootTools = join(nodeModules, '@deepseek-ai', 'dsh-tools')
  const base = join(nodeModules, '@deepseek-ai', 'dsh-base')
  const agentLoop = join(base, 'node_modules', '@deepseek-ai', 'dsh-agent-loop')
  const minimal = join(nodeModules, '@deepseek-ai', 'dsh-sdk-minimal')
  const agentLoopTools = join(agentLoop, 'node_modules', '@deepseek-ai', 'dsh-tools')
  const minimalTools = join(minimal, 'node_modules', '@deepseek-ai', 'dsh-tools')
  const agentLoopNativeTools = join(agentLoop, 'node_modules', '@deepseek-ai', 'dsh-native-tools')
  const minimalNativeTools = join(minimal, 'node_modules', '@deepseek-ai', 'dsh-native-tools')
  const agentLoopSession = join(agentLoop, 'node_modules', '@deepseek-ai', 'dsh-session')
  const minimalSession = join(minimal, 'node_modules', '@deepseek-ai', 'dsh-session')
  const agentLoopContext = join(agentLoop, 'node_modules', '@deepseek-ai', 'dsh-context')
  const minimalContext = join(minimal, 'node_modules', '@deepseek-ai', 'dsh-context')
  const rootNativeTools = join(nodeModules, '@deepseek-ai', 'dsh-native-tools')
  const rootSession = join(nodeModules, '@deepseek-ai', 'dsh-session')
  const rootContext = join(nodeModules, '@deepseek-ai', 'dsh-context')
  const rootExternalPeer = join(nodeModules, '@fixture', 'runtime-peer')
  const minimalExternalPeer = join(minimalSession, 'node_modules', '@fixture', 'runtime-peer')
  const aliasTools = join(nodeModules, '@fixture', 'dsh-tools')
  const toolsSource = join(workspaceRoot, 'rsh/Engine/core/tools')
  const nativeToolsSource = join(workspaceRoot, 'rsh/Engine/core/native-tools')
  const sessionSource = join(workspaceRoot, 'rsh/Engine/core/session')
  const contextSource = join(workspaceRoot, 'rsh/Engine/core/context')
  const closureSource = join(workspaceRoot, 'rsh/Programs/SDK/python/sdk-runtime')
  const toolsCode = "import { nativeTools } from '@deepseek-ai/dsh-native-tools'; export const scheduler = Symbol('scheduler'); export const resolvedToolsUrl = import.meta.url; export const resolvedNativeToolsUrl = import.meta.resolve('@deepseek-ai/dsh-native-tools'); export const attachedNativeTools = nativeTools\n"
  const nativeToolsCode = "import { getSessionScheduler } from '@deepseek-ai/dsh-session'; export const nativeTools = { getSessionScheduler }; export const resolvedNativeToolsUrl = import.meta.url\n"
  const sessionCode = "import { scheduler } from '@deepseek-ai/dsh-tools'; import { context } from '@deepseek-ai/dsh-context'; export const getSessionScheduler = () => scheduler; export { context }; export const resolvedSessionUrl = import.meta.url; export const resolvedContextUrl = import.meta.resolve('@deepseek-ai/dsh-context')\n"
  const contextCode = "export const context = Symbol('context'); export const resolvedContextUrl = import.meta.url\n"
  const toolsManifest = {
    name: '@deepseek-ai/dsh-tools',
    version: '0.1.5-rc.2',
    type: 'module',
    exports: { '.': './lib/index.js' },
    dependencies: { '@deepseek-ai/dsh-native-tools': 'workspace:^' },
    peerDependencies: { '@deepseek-ai/dsh-session': 'workspace:^' },
  }
  const nativeToolsManifest = {
    name: '@deepseek-ai/dsh-native-tools',
    version: '0.1.5-rc.2',
    type: 'module',
    exports: { '.': './lib/index.js' },
    dependencies: { '@deepseek-ai/dsh-session': 'workspace:^' },
  }
  const sessionManifest = {
    name: '@deepseek-ai/dsh-session',
    version: '0.1.5-rc.2',
    type: 'module',
    exports: { '.': './lib/index.js' },
    peerDependencies: {
      '@deepseek-ai/dsh-tools': 'workspace:^',
      '@deepseek-ai/dsh-context': 'workspace:^',
      '@fixture/runtime-peer': '^1.0.0',
    },
  }
  const contextManifest = {
    name: '@deepseek-ai/dsh-context',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './lib/index.js' },
  }
  const closureDependencies = { '@deepseek-ai/dsh-tools': 'workspace:^' }
  writePackage(staging, {
    name: 'dsh-python-runtime-closure',
    dependencies: closureDependencies,
  })
  writeFileSync(join(staging, 'runtime-bootstrap.mjs'), "import '@deepseek-ai/dsh-tools'\n")
  writePackage(rootTools, toolsManifest, { 'lib/index.js': toolsCode })
  writePackage(rootNativeTools, nativeToolsManifest, { 'lib/index.js': nativeToolsCode })
  writePackage(rootSession, sessionManifest, { 'lib/index.js': sessionCode })
  writePackage(rootContext, contextManifest, { 'lib/index.js': contextCode })
  writePackage(rootExternalPeer, {
    name: '@fixture/runtime-peer',
    version: '1.0.0',
    type: 'module',
    exports: { '.': './index.js' },
  }, { 'index.js': 'export const peer = true\n' })

  const consumerEntry = "import { scheduler, attachedNativeTools, resolvedToolsUrl, resolvedNativeToolsUrl } from '@deepseek-ai/dsh-tools'; import { getSessionScheduler, context, resolvedSessionUrl, resolvedContextUrl } from '@deepseek-ai/dsh-session'; export { scheduler }; export const resolvedModuleUrls = [resolvedToolsUrl, resolvedNativeToolsUrl, resolvedSessionUrl, resolvedContextUrl]; export const resolvePrepare = tools => tools[scheduler]?.prepare; export const sharedInstances = [attachedNativeTools, context]; export const sessionScheduler = getSessionScheduler()\n"
  writeConsumer(base, '@deepseek-ai/dsh-base', consumerEntry, {
    '@deepseek-ai/dsh-tools': 'workspace:^',
    '@deepseek-ai/dsh-session': 'workspace:^',
  })
  writeConsumer(agentLoop, '@deepseek-ai/dsh-agent-loop', consumerEntry, {}, {
    '@deepseek-ai/dsh-tools': 'workspace:^',
    '@deepseek-ai/dsh-session': 'workspace:^',
  })
  writeConsumer(minimal, '@deepseek-ai/dsh-sdk-minimal', consumerEntry, {
    '@deepseek-ai/dsh-tools': 'workspace:^',
    '@deepseek-ai/dsh-session': 'workspace:^',
  })

  const nestedManifest = { ...toolsManifest, exports: mismatch === 'manifest' ? { '.': './lib/missing.js' } : toolsManifest.exports }
  const toolsNestedCode = mismatch === 'file' ? "export const scheduler = Symbol('other')\n" : toolsCode
  for (const directory of [agentLoopTools, minimalTools]) writePackage(directory, directory === minimalTools ? nestedManifest : toolsManifest, { 'lib/index.js': toolsNestedCode })
  for (const directory of [agentLoopNativeTools, minimalNativeTools]) writePackage(directory, nativeToolsManifest, { 'lib/index.js': nativeToolsCode })
  for (const directory of [agentLoopSession, minimalSession]) writePackage(directory, sessionManifest, { 'lib/index.js': sessionCode })
  for (const directory of [agentLoopContext, minimalContext]) {
    writePackage(directory, contextManifest, { 'lib/index.js': contextCode })
  }
  if (mismatch === 'peer') {
    writePackage(minimalExternalPeer, {
      name: '@fixture/runtime-peer',
      version: '2.0.0',
      type: 'module',
      exports: { '.': './index.js' },
    }, { 'index.js': 'export const peer = true\n' })
  }
  writePackage(aliasTools, toolsManifest, { 'lib/index.js': "export const scheduler = Symbol('alias')\n" })

  writePackage(workspaceRoot, { name: 'dsh-fixture-workspace', private: true })
  writePackage(toolsSource, toolsManifest, { 'lib/index.js': toolsCode })
  writePackage(nativeToolsSource, nativeToolsManifest, { 'lib/index.js': nativeToolsCode })
  writePackage(sessionSource, sessionManifest, { 'lib/index.js': sessionCode })
  writePackage(contextSource, contextManifest, { 'lib/index.js': contextCode })
  writePackage(closureSource, { name: 'dsh-python-runtime-closure', dependencies: closureDependencies })
  writeFileSync(join(workspaceRoot, 'pnpm-lock.yaml'), stringifyYaml({
    lockfileVersion: '9.0',
    importers: {
      '.': {},
      'rsh/Programs/SDK/python/sdk-runtime': {
        dependencies: linkEntries(workspaceRoot, 'rsh/Programs/SDK/python/sdk-runtime', closureDependencies),
      },
      'rsh/Engine/core/tools': {
        dependencies: linkEntries(workspaceRoot, 'rsh/Engine/core/tools', toolsManifest.dependencies),
      },
      'rsh/Engine/core/native-tools': {
        dependencies: linkEntries(workspaceRoot, 'rsh/Engine/core/native-tools', nativeToolsManifest.dependencies),
      },
      'rsh/Engine/core/session': {},
      'rsh/Engine/core/context': {},
    },
  }))

  return {
    staging,
    workspaceRoot,
    agentLoopTools,
    minimalTools,
    agentLoopNativeTools,
    minimalNativeTools,
    agentLoopSession,
    minimalSession,
    agentLoopContext,
    minimalContext,
    aliasTools,
  }
}

function linkEntries(workspaceRoot: string, importer: string, dependencies: Record<string, string>) {
  const importerDirectory = resolve(workspaceRoot, importer)
  return Object.fromEntries(Object.entries(dependencies).map(([name, specifier]) => {
    const sourceDirectory = resolve(workspaceRoot, {
      '@deepseek-ai/dsh-tools': 'rsh/Engine/core/tools',
      '@deepseek-ai/dsh-native-tools': 'rsh/Engine/core/native-tools',
      '@deepseek-ai/dsh-session': 'rsh/Engine/core/session',
      '@deepseek-ai/dsh-context': 'rsh/Engine/core/context',
    }[name]!)
    return [name, { specifier, version: `link:${relative(importerDirectory, sourceDirectory).replaceAll('\\', '/')}` }]
  }))
}

function writeConsumer(
  directory: string,
  name: string,
  entry: string,
  dependencies: Record<string, string>,
  peerDependencies: Record<string, string> = {},
): void {
  writePackage(directory, {
    name,
    version: '0.1.5-rc.2',
    type: 'module',
    dependencies,
    peerDependencies,
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
