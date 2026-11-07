import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import { plugin as filesystemPlugin } from '@redspark/rsh-fs-local/native'
import { plugin as subprocessPlugin } from '@redspark/rsh-subprocess-local/native'
import { LspRegistry } from '../../lsp/src/registry.ts'
import type { LspQueryRequest, LspService } from '@redspark/rsh-lsp'
import { plugin as lspPlugin } from '../../lsp/src/native.ts'
import { plugin } from '../src/native.ts'

const fixtureServer = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))
const hosts: NativeHost[] = []

let root: string
let ws: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-native-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\nconst y = x\n')
  await writeFile(join(ws, 'a.py'), 'x = 1\n')
})

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop().catch(() => undefined)))
  await rm(root, { recursive: true, force: true })
})

function query(operation: LspQueryRequest['operation'], filePath = 'a.ts'): LspQueryRequest {
  return { operation, filePath, position: { line: 0, character: 6 }, workspaceRoot: ws }
}

function locationJson(line: number): unknown {
  return { uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line, character: 0 }, end: { line, character: 3 } } }
}

function server(extension: string, languageId: string, env: Record<string, string>) {
  return {
    command: process.execPath,
    args: [fixtureServer],
    env,
    extensionToLanguage: { [extension]: languageId },
  }
}

/** Mount filesystem, subprocess, the native LSP seam, and stdio servers. */
async function mount(servers: Record<string, ReturnType<typeof server>>): Promise<LspService> {
  const scope = new NativeScope()
  let lsp!: LspService
  const probe: NativePlugin = {
    apiVersion: 1, name: 'lsp-stdio-probe', targets: ['host'], requires: ['lsp'], optional: [], provides: [],
    resolve: () => (context) => { lsp = context.require('lsp') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin: filesystemPlugin, scope, config: { cwd: process.cwd() } },
    { plugin: subprocessPlugin, scope, config: undefined },
    { plugin: lspPlugin, scope, config: undefined },
    { plugin: probe, scope, config: undefined },
    { plugin, scope, config: { servers } },
  ], 'host'))
  hosts.push(host)
  await host.start()
  return lsp
}

describe('native lsp-stdio', () => {
  it('routes each extension to its own configured server', async () => {
    const lsp = await mount({
      typescript: server('.ts', 'typescript', { LSP_FAKE_HOVER: JSON.stringify({ contents: 'ts' }) }),
      python: server('.py', 'python', { LSP_FAKE_HOVER: JSON.stringify({ contents: 'py' }) }),
    })
    await expect(lsp.query(query('hover', 'a.ts'))).resolves.toEqual({ kind: 'hover', hover: { contents: 'ts' } })
    await expect(lsp.query(query('hover', 'a.py'))).resolves.toEqual({ kind: 'hover', hover: { contents: 'py' } })
  })

  it('rolls back earlier servers when a later extension conflicts', async () => {
    const scope = new NativeScope()
    const registry = new LspRegistry()
    const seam: NativePlugin = {
      apiVersion: 1, name: 'lsp-stdio-seam', targets: ['host'], requires: [], optional: [], provides: ['lsp'],
      resolve: () => (context) => { context.provide('lsp', registry) },
    }
    const host = new NativeHost(resolveInstallation([
      { plugin: filesystemPlugin, scope, config: { cwd: process.cwd() } },
      { plugin: subprocessPlugin, scope, config: undefined },
      { plugin: seam, scope, config: undefined },
      { plugin, scope, config: { servers: {
        first: server('.ts', 'typescript', {}),
        second: server('.ts', 'typescript', {}),
      } } },
    ], 'host'))
    hosts.push(host)
    await expect(host.start()).rejects.toThrow(expect.objectContaining({ code: 'LSP_CONFLICT' }))
    await expect(registry.query(query('goToDefinition'))).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
  })

  it('serves the four semantic queries through one stdio server', async () => {
    const lsp = await mount({
      typescript: server('.ts', 'typescript', {
        LSP_FAKE_DEF: JSON.stringify(locationJson(0)),
        LSP_FAKE_REFS: JSON.stringify([locationJson(0), locationJson(1)]),
        LSP_FAKE_IMPL: JSON.stringify(locationJson(1)),
        LSP_FAKE_HOVER: JSON.stringify({ contents: { kind: 'markdown', value: 'docs' } }),
      }),
    })
    const definition = await lsp.query(query('goToDefinition'))
    const references = await lsp.query(query('findReferences'))
    const implementation = await lsp.query(query('goToImplementation'))
    const hover = await lsp.query(query('hover'))
    expect(definition).toMatchObject({ kind: 'locations', resolvedWorkspaceUri: pathToFileURL(ws).href })
    expect(references).toMatchObject({ kind: 'locations' })
    expect(implementation).toMatchObject({ kind: 'locations' })
    expect(hover).toEqual({ kind: 'hover', hover: { contents: 'docs' } })
    if (references.kind !== 'locations') throw new Error('expected locations')
    expect(references.locations).toHaveLength(2)
  })
})
