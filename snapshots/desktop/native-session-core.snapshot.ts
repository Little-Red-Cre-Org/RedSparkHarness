/** Native Desktop Session round trip through Electron's real private Host byte pipes. */
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { resolveDesktopPaths } from '../../rsh/Programs/Desktop/src/paths.ts'
import { DesktopProjectManager } from '../../rsh/Programs/Desktop/src/project-manager.ts'
import { writeDesktopRuntime } from '../../rsh/Programs/Desktop/src/runtime-tree.ts'
import { desktopRuntimeFileExclusion } from '../../rsh/Programs/Desktop/scripts/runtime-file-policy.ts'
import { DesktopBackendController } from '../../rsh/Programs/Desktop/src/backend-controller.ts'
import { DesktopHostProcess } from '../../rsh/Programs/Desktop/src/host-process.ts'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { normalizeSessionSnapshot, redactSessionSnapshotIds, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'

const repository = fileURLToPath(new URL('../../', import.meta.url))
const scenario = fileURLToPath(new URL('./native-session-core/', import.meta.url))

it('executes and cold-resumes a native Desktop Session over private framed pipes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rsh-desktop-native-'))
  const runtime = join(home, 'runtime')
  const deployment = join(home, 'deployment')
  let host: DesktopHostProcess | undefined
  let backend: DesktopBackendController<DesktopHostProcess> | undefined
  try {
    const fixture = process.env.DSH_SNAPSHOT === 'refresh' ? undefined
      : readFileSync(join(scenario, sessionFixtureName(0, SESSION_FORMAT_VERSION)), 'utf8').trim().split('\n')
        .map(line => JSON.parse(line) as { type?: string; data?: { content?: { type: string; text?: string }[] } })
    const inputs = fixture?.filter(event => event.type === 'user/message')
      .map(event => event.data?.content?.find(block => block.type === 'text')?.text)
      ?? ['Native desktop input.', 'Continue the native desktop conversation.']
    if (inputs.length !== 2 || inputs.some(text => text === undefined)) throw new Error('recorded Desktop Session requires two user inputs')
    const sessionConfig = shippedNativeProfileComposition(home, 'native-web').installations
      .find(row => row.plugin === '@deepseek-ai/dsh-native-web-session-controller')?.config
    if (sessionConfig === undefined) throw new Error('shipped native-web omitted Session settings')
    const deployed = await execa('pnpm', ['--config.node-linker=hoisted', '--config.enable-global-virtual-store=false', '--config.inject-workspace-packages=true', '--filter', '@deepseek-ai/dsh-desktop-host', 'deploy', '--prod', deployment], { cwd: repository, reject: false })
    // Deploy rewrites the reviewed workspace script's file locator to an absolute URI.
    const script = '@deepseek-ai/dsh-subprocess-local'
    const locator = script + '@' + pathToFileURL(join(repository, 'rsh/Core/subprocess/subprocess-local')).href
    const workspaceFile = join(deployment, 'pnpm-workspace.yaml')
    const settings = readFileSync(workspaceFile, 'utf8')
    const pending = settings.split('\n').filter(line => line.includes('set this to true or false'))
    expect(pending).toEqual(["  '" + locator + "': set this to true or false"])
    expect(readFileSync(join(repository, 'pnpm-workspace.yaml'), 'utf8')).toContain("'" + script + "@file:rsh/Core/subprocess/subprocess-local': true")
    expect(deployed.stderr + deployed.stdout).toContain('ERR_PNPM_IGNORED_BUILDS')
    writeFileSync(workspaceFile, settings.replace(pending[0]!, "  '" + locator + "': true"))
    const rebuilt = await execa('pnpm', ['--dir', deployment, 'rebuild', script], { cwd: repository, reject: false })
    expect(rebuilt.exitCode, rebuilt.stderr).toBe(0)
    const modules = join(deployment, 'node_modules')
    cpSync(modules, join(runtime, 'node_modules'), { recursive: true, dereference: true,
      filter: path => desktopRuntimeFileExclusion(relative(modules, path), process) === undefined })
    const hostPackage = join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host')
    mkdirSync(hostPackage)
    for (const file of ['lib', 'config', 'package.json']) cpSync(join(deployment, file), join(hostPackage, file), { recursive: true, dereference: true })
    writeFileSync(join(runtime, 'package.json'), JSON.stringify({ name: 'desktop-runtime-snapshot', private: true, type: 'module' }))
    const version = JSON.parse(readFileSync(join(hostPackage, 'package.json'), 'utf8')).version as string
    const shared = readdirSync(join(runtime, 'node_modules/@deepseek-ai')).map(name => '@deepseek-ai/' + name)
    const pnpmVersion = (await execa('pnpm', ['--version'], { cwd: repository })).stdout.trim()
    writeDesktopRuntime(runtime, { version, nodeVersion: process.versions.node, pnpmVersion }, shared)
    const clientManifest = join(runtime, 'node_modules/@deepseek-ai/dsh-client-native-application/package.json')
    expect(existsSync(clientManifest), deployed.stdout).toBe(true)
    const realClient = realpathSync(clientManifest)
    expect(realClient.startsWith(realpathSync(runtime)), realClient).toBe(true)
    const paths = resolveDesktopPaths(home)
    const project = paths.profile
    const workspace = join(home, 'work')
    const storage = join(home, 'sessions')
    mkdirSync(project, { recursive: true }); mkdirSync(workspace)
    const model = join(project, 'node_modules', 'desktop-fixture-model')
    mkdirSync(model, { recursive: true })
    writeFileSync(join(model, 'package.json'), JSON.stringify({
      name: 'desktop-fixture-model', type: 'module', exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
    }))
    writeFileSync(join(model, 'native.mjs'), `import { writeFileSync } from 'node:fs';
  export const plugin = { apiVersion: 1, name: 'desktop-fixture-model', targets: ['host'], requires: [], provides: ['model'],
  resolve: () => context => { writeFileSync(${JSON.stringify(join(home, 'activated.txt'))}, 'active'); context.provide('model', { async *stream(request) {
  writeFileSync(${JSON.stringify(join(home, 'model-request.json'))}, JSON.stringify(request));
  const text = 'Native desktop answer.';
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
  } }); } }`)
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-runtime', version: '0.0.0', private: true,
      dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } } }))
    writeFileSync(join(project, 'rsh.client.json'), JSON.stringify({ formatVersion: 1, installations: [
      { id: 'application', plugin: '@deepseek-ai/dsh-client-native-application' },
      { id: 'renderer', plugin: '@deepseek-ai/dsh-client-ui-renderer' },
      { id: 'connection', plugin: '@deepseek-ai/dsh-client-connection' },
      { id: 'session', plugin: '@deepseek-ai/dsh-client-native-session' },
    ] }))
    const rows = [
      ['sessions', 'native-web-session-controller', { ...sessionConfig as object,
        cwd: workspace, provider: 'mock', model: 'fixture', systemPrompt: 'Answer the user.', maxSteps: 1 }],
      ['agents', 'native-agent'], ['execution', 'native-session-execution'], ['model-execution', 'native-model-execution'],
      ['fs', 'fs-local', { cwd: workspace }], ['storage', 'session-persistence-jsonl', { root: storage, compression: 'none' }],
      ['credentials', 'credentials-local', { path: join(home, 'credentials.json') }],
    ] as const
    writeFileSync(join(project, 'rsh.profile.json'), JSON.stringify({ formatVersion: 1, scopes: [{ id: 'root' }], installations: [
      ...rows.map(([id, name, config]) => ({ id, plugin: `@deepseek-ai/dsh-${name}`, scope: 'root', ...config === undefined ? {} : { config } })),
      { id: 'model', plugin: 'desktop-fixture-model', scope: 'root' },
    ] }))
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: 'unused', dsh: runtime })
    const start = (onFailure?: (error: Error) => void): DesktopHostProcess => new DesktopHostProcess(process.execPath, runtime, project, undefined, { ...process.env, DSH_HOME: home }, onFailure)
    const sessionId = 'native-desktop-recorded'
    const manifestPath = join(project, 'package.json')
    const manifest = readFileSync(manifestPath, 'utf8')
    const refusal = async (message: string): Promise<void> => {
      host = start()
      await expect(host.start()).rejects.toThrow(message)
      await host.stop()
      host = undefined
      expect(existsSync(join(home, 'activated.txt'))).toBe(false)
    }
    const live = JSON.parse(manifest)
    live.dsh.profile.configReload = 'live'
    writeFileSync(manifestPath, JSON.stringify(live))
    await refusal('native profiles require configReload startup')
    writeFileSync(manifestPath, manifest)
    const patch = join(project, 'desktop.cordis.yml')
    writeFileSync(patch, '- id: legacy\n')
    await refusal('cannot apply Cordis patch')
    unlinkSync(patch)
    const outside = join(home, 'external-model')
    renameSync(model, outside)
    symlinkSync(outside, model, 'junction')
    await refusal('invalid package desktop-fixture-model')
    unlinkSync(model)
    renameSync(outside, model)
    expect(manager.supportsLegacyPluginManagement()).toBe(false)
    backend = new DesktopBackendController(onFailure => { manager.assertProfileRuntime(project); return start(onFailure) }, () => {})
    await backend.start(async () => { expect(await manager.applyRelease()).toBe(true) })
    await expect(manager.mutate({ type: 'plugins-disable-all' }, { beforeChange: async () => { throw new Error('must not stop Host') }, afterChange: async () => {} })).rejects.toThrow('native profiles do not support compatibility plugin management')
    host = backend.host
    if (host === undefined) throw new Error('Desktop backend omitted its ready Host')
    const page = await host.fetch(new Request('dsh-app://app/'))
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('__DSH_NATIVE_CLIENT_BOOT__')
    expect(html).toContain('ownsHost:true')
    const bundle = /"bundle":"([^"]+)"/u.exec(html)?.[1]
    if (bundle === undefined) throw new Error('Desktop omitted native Client bundle')
    const bundleResponse = await host.fetch(new Request(`dsh-app://app${bundle}`))
    expect(bundleResponse.status).toBe(200)
    expect((await bundleResponse.arrayBuffer()).byteLength).toBeGreaterThan(0)
    expect((await host.fetch(new Request('http://127.0.0.1/api/session/list'))).status).toBe(403)
    const invoke = async (text: string, resume: boolean): Promise<void> => {
      if (host === undefined) throw new Error('missing Desktop Host')
      const response = await host.fetch(new Request('dsh-app://app/api/session/prompt', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'desktop-session', method: 'session/prompt', payload: { sessionId, text, resume } }),
      }))
      expect(await response.json()).toMatchObject({ result: { ok: true, value: { exitCode: 0, answer: 'Native desktop answer.' } } })
    }
    await invoke(inputs[0]!, false)
    await backend.stop()
    await backend.start(async () => { expect(await manager.applyRelease()).toBe(false) })
    host = backend.host
    if (host === undefined) throw new Error('Desktop backend omitted its resumed Host')
    await invoke(inputs[1]!, true)
    expect(readFileSync(join(home, 'model-request.json'), 'utf8')).toContain(inputs[0]!)
    await backend.stop()
    const name = sessionFixtureName(0, SESSION_FORMAT_VERSION)
    const stored = readdirSync(storage, { recursive: true }).find(path => typeof path === 'string' && path.endsWith(name))
    if (typeof stored !== 'string') throw new Error('Desktop omitted durable Session')
    const raw = readFileSync(join(storage, stored), 'utf8')
    const context = { sessionIds: [sessionId], cwd: workspace }
    const normalized = normalizeSessionSnapshot(redactSessionSnapshotIds([raw])[0] ?? raw, { ...context, sessionIds: [] }, { identityMode: 'preserve' })
    if (normalized === undefined) throw new Error('missing normalized Desktop Session')
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      const prompts = normalizedSystemPrompts(raw, context), schemas = normalizedToolSchemas(raw, context)
      writeFileSync(join(scenario, name), normalized)
      writeFileSync(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0]!, prompts.slice(1)))
      writeFileSync(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemas[0]!, schemas.slice(1)))
    } else expect(normalized).toBe(readFileSync(join(scenario, name), 'utf8'))
  } finally {
    await backend?.close()
    await host?.stop()
    rmSync(home, { recursive: true, force: true })
  }
}, 240000)
