import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import { EVENT_API, SERVICE_API, TYPE_API } from '@deepseek-ai/dsh-tool-cordis/src/api-catalog.ts'
import { hostInspectProviders } from '@deepseek-ai/dsh-tool-cordis/src/providers.ts'
import type { HostCordisInspectQueryContext } from '@deepseek-ai/dsh-tool-cordis/src/providers.ts'
import { WorkspaceAnalyzer } from '../src/analyzer.ts'
import { FaceModelEmitter } from '../src/emitter.ts'

const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('model-driven dsh-tools generation', () => {
  it('returns the specialized approval Service and its public types through Host Inspect', async () => {
    const provider = hostInspectProviders(new Context()).find(candidate => candidate.manifest.id === 'Service')
    if (provider === undefined) throw new Error('Host Inspect has no Service provider')
    const result = await provider.query('listService', { service: 'approval' }, {
      signal: new AbortController().signal,
      agent: { id: 'approval-catalog' as HostCordisInspectQueryContext['agent']['id'] },
    }) as {
      service: { methods: readonly { signature: string; description: string; throws?: readonly string[] }[] }
      referencedTypes: readonly { name: string; declaration: string }[]
    }

    const methods = result.service.methods
    expect(methods.map(method => method.signature)).toEqual(expect.arrayContaining([
      'setPolicy(agent: Agent, policy: ApprovalPolicy): void',
      'request(request: ApprovalRequest<Agent>): Promise<ApprovalOutcome>',
    ]))
    const request = methods.find(method => method.signature === 'request(request: ApprovalRequest<Agent>): Promise<ApprovalOutcome>')
    expect(request?.description).toContain('open Session turn')
    expect(request?.description).toContain('approval/asked')
    expect(request?.description).toContain('approval/decided')
    expect(request?.description).toContain('reject before appending')
    expect(request?.description).toContain('failure before either audit append commits rejects the request')
    expect(request?.throws).toEqual(expect.arrayContaining([
      'When the Session has no open turn or either audit append fails before commit.',
    ]))
    expect(result.referencedTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ApprovalRequest', declaration: expect.stringContaining('interface ApprovalRequest') }),
      expect.objectContaining({ name: 'Agent', declaration: expect.stringContaining('interface Agent') }),
    ]))
  })

  it('round-trips the complete service and event structure through the runtime registry', { timeout: 30_000 }, async () => {
    const workspace = new WorkspaceAnalyzer({
      root: workspaceRoot,
      faces: ['host'],
      packages: ['@deepseek-ai/dsh-tools'],
    }).analyze()
    const host = workspace.faces.find(candidate => candidate.face === 'host')
    if (host === undefined) throw new Error('dsh-tools has no analyzed host face')
    const artifact = new FaceModelEmitter(host).emit('@deepseek-ai/dsh-tools')

    const root = mkdtempSync(join(import.meta.dirname, '.generated-tools-'))
    temporaryRoots.push(root)
    const modulePath = join(root, 'host.mjs')
    writeFileSync(modulePath, artifact.js)
    const generated = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`) as {
      TYPERT: TypertContribution
    }

    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    const dispose = ctx.typert.register(generated.TYPERT)
    const record = ctx.typert.getPackage('@deepseek-ai/dsh-tools', 'host')
    const service = record?.model.services.find(candidate => candidate.key === 'tools')
    expect(service).toBeDefined()
    expect({
      key: service?.key,
      summary: service?.summary,
      methods: service?.members
        .filter(member => member.kind === 'method' && !member.name.startsWith('['))
        .map(member => member.signature),
    }).toEqual((() => {
      const api = SERVICE_API.find(candidate => candidate.key === 'tools')
      return {
        key: api?.key,
        summary: api?.summary,
        methods: api?.methods.map(method => method.signature),
      }
    })())
    expect(record?.model.events.filter(event => event.name.startsWith('tools/')).map(event => ({
      name: event.name,
      mode: event.mode,
      signature: event.signature,
      summary: event.summary,
    }))).toEqual(EVENT_API.filter(event => event.name.startsWith('tools/')).map(event => ({
      name: event.name,
      mode: event.mode,
      signature: event.signature,
      summary: event.summary,
    })))
    expect(service?.types.find(type => type.name === 'ToolDefinition')).toEqual(
      TYPE_API.find(type => type.name === 'ToolDefinition'),
    )

    await dispose()
    expect(ctx.typert.getPackage('@deepseek-ai/dsh-tools', 'host')).toBeUndefined()
  })
})
