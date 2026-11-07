import { afterEach, describe, expect, it } from 'vitest'
import { NativeHost, NativeScope, resolveInstallation, type NativePlugin } from '@redspark/rsh-native-runtime'
import {
  LspProviderId,
  type LspProvider,
  type LspProviderQuery,
  type LspQueryRequest,
  type LspQueryResult,
  type LspService,
} from '@redspark/rsh-lsp'
import { plugin } from '../src/native.ts'

const hosts: NativeHost[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop().catch(() => undefined)))
})

/** A scripted provider that records the queries it receives. */
function makeProvider(
  id: string,
  extensionToLanguage: Record<string, string>,
  result: LspQueryResult = { kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws' },
): LspProvider & { seen: LspProviderQuery[] } {
  const seen: LspProviderQuery[] = []
  return {
    id: LspProviderId(id),
    extensionToLanguage,
    seen,
    query(request) {
      seen.push(request)
      return Promise.resolve(result)
    },
  }
}

function query(filePath: string, operation: LspQueryRequest['operation'] = 'goToDefinition'): LspQueryRequest {
  return { operation, filePath, position: { line: 0, character: 0 }, workspaceRoot: '/ws' }
}

/** Start the native LSP Provider and return the service it published. */
async function mount(): Promise<LspService> {
  const scope = new NativeScope()
  let lsp!: LspService
  const probe: NativePlugin = {
    apiVersion: 1, name: 'lsp-probe', targets: ['host'], requires: ['lsp'], optional: [], provides: [],
    resolve: () => (context) => { lsp = context.require('lsp') },
  }
  const host = new NativeHost(resolveInstallation([
    { plugin, scope, config: undefined },
    { plugin: probe, scope, config: undefined },
  ], 'host'))
  hosts.push(host)
  await host.start()
  return lsp
}

describe('native lsp', () => {
  it('routes each extension to its provider and ignores registration order', async () => {
    const lsp = await mount()
    const hover: LspQueryResult = { kind: 'hover', hover: { contents: 'x' } }
    const ts = makeProvider('ts', { '.ts': 'typescript' }, hover)
    const py = makeProvider('py', { '.py': 'python' })
    lsp.registerProvider(py)
    lsp.registerProvider(ts)
    await expect(lsp.query(query('a.py'))).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws' })
    await expect(lsp.query(query('src/Foo.TS', 'hover'))).resolves.toEqual(hover)
    expect(py.seen[0]).toMatchObject({ filePath: 'a.py', languageId: 'python' })
    expect(ts.seen[0]).toMatchObject({ filePath: 'src/Foo.TS', languageId: 'typescript' })
  })

  it('rejects a conflicting registration without publishing any of its extensions', async () => {
    const lsp = await mount()
    lsp.registerProvider(makeProvider('ts', { '.ts': 'typescript' }))
    expect(() => lsp.registerProvider(makeProvider('py-ts', { '.py': 'python', '.ts': 'x' })))
      .toThrow(expect.objectContaining({ code: 'LSP_CONFLICT' }))
    await expect(lsp.query(query('a.py'))).rejects.toThrow(expect.objectContaining({ code: 'LSP_UNAVAILABLE' }))
    await expect(lsp.query(query('a.ts'))).resolves.toMatchObject({ kind: 'locations' })
  })

  it('forwards the four semantic queries to the selected provider', async () => {
    const lsp = await mount()
    const seen: LspProviderQuery[] = []
    lsp.registerProvider({
      id: LspProviderId('ts'),
      extensionToLanguage: { '.ts': 'typescript' },
      query(request) {
        seen.push(request)
        return Promise.resolve(request.operation === 'hover'
          ? { kind: 'hover', hover: { contents: request.operation } }
          : { kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws' })
      },
    })
    const operations = ['goToDefinition', 'findReferences', 'goToImplementation', 'hover'] as const
    for (const operation of operations) {
      const result = await lsp.query(query('a.ts', operation))
      expect(result.kind).toBe(operation === 'hover' ? 'hover' : 'locations')
    }
    expect(seen.map(request => request.operation)).toEqual([...operations])
    expect(seen.every(request => request.languageId === 'typescript')).toBe(true)
  })
})
