/** Real Loader composition for filesystem runtime adapters. */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-sandbox'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import RshPluginHost from '@deepseek-ai/dsh-plugin-host'
import FsPolicyRuntime from '@deepseek-ai/dsh-fs-observation-policy/runtime'
import FsSandboxRuntime from '@deepseek-ai/dsh-fs-sandbox/runtime'
import ToolFsRuntime from '@deepseek-ai/dsh-tool-fs/runtime'

let root: string | undefined
let ctx: Context | undefined

async function boot(toolConfig = ''): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-fs-runtime-loader-'))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- id: 'plugin-host'",
    "  name: '@test/plugin-host'",
    "- id: 'system-prompt'",
    "  name: '@test/system-prompt'",
    "- id: 'session-projections'",
    "  name: '@test/session-projections'",
    "- id: 'tools'",
    "  name: '@test/tools'",
    "- id: 'sandbox-policy'",
    "  name: '@test/sandbox-policy'",
    '  config:',
    '    mode: danger-full-access',
    `    workspaceRoot: ${JSON.stringify(workspace)}`,
    "- id: 'fs-observation-policy'",
    "  name: '@test/fs-observation-policy'",
    "- id: 'fs-sandbox'",
    "  name: '@test/fs-sandbox'",
    '  config:',
    `    cwd: ${JSON.stringify(workspace)}`,
    "- id: 'tool-fs'",
    "  name: '@test/tool-fs'",
    ...toolConfig === '' ? [] : ['  config:', `    readLimit: ${toolConfig}`],
    '',
  ].join('\n'))
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@test/plugin-host', RshPluginHost],
    ['@test/system-prompt', SystemPrompt],
    ['@test/session-projections', SessionProjectionRegistry],
    ['@test/tools', ToolRuntime],
    ['@test/sandbox-policy', SandboxPolicyService],
    ['@test/fs-observation-policy', FsPolicyRuntime],
    ['@test/fs-sandbox', FsSandboxRuntime],
    ['@test/tool-fs', ToolFsRuntime],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const plugin = modules.get(specifier)
      if (plugin === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return plugin
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const provider = ctx.get('fs')
  const entries = [...ctx.loader.entries()]
  if (provider === undefined) throw new Error(`filesystem Provider is absent after Loader activation: ${entries.map(entry => `${entry.options.id}:${entry.fiber?.state ?? 'none'}`).join(', ')}`)
  const inactive = entries.filter(entry => entry.fiber === undefined && !entry.disabled)
  if (inactive.length > 0) throw new Error(`inactive Loader entries: ${inactive.map(entry => entry.options.id).join(', ')}`)
  return ctx
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function readLines(context: Context): Promise<unknown> {
  const target = await context.fs.resolve('sample.txt')
  await context.fs.writeText(target, 'one\ntwo\nthree')
  const result = await context.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('runtime-loader-read'),
    name: 'read',
    arguments: { file_path: 'sample.txt' },
  })
  if (result.isError) throw result.error
  return result.value
}

describe('filesystem runtime adapters through Loader', () => {
  it('applies tool defaults and releases all adapted entries on Loader disposal', async () => {
    const context = await boot()
    expect(context.fs).toBeDefined()
    expect(context.tools.schemas().map(schema => schema.name).sort()).toEqual(['edit', 'read', 'write'])
    expect(context.pluginHost.entries().map(entry => entry.packageName).sort()).toEqual([
      '@deepseek-ai/dsh-fs-observation-policy',
      '@deepseek-ai/dsh-fs-sandbox',
      '@deepseek-ai/dsh-tool-fs',
    ])
    expect((await readLines(context) as { lines: unknown[] }).lines).toHaveLength(3)

    const entries = [...context.loader.entries()]
    for (const id of ['tool-fs', 'fs-sandbox', 'fs-observation-policy']) {
      const entry = entries.find(candidate => candidate.options.id === id)
      await entry?.fiber?.dispose()
    }
    expect(context.get('fs')).toBeUndefined()
    expect(context.tools.schemas()).toHaveLength(0)
    expect(context.pluginHost.entries()).toEqual([])
  })

  it('passes explicit adapter configuration through the original Config schema', async () => {
    const context = await boot('1')
    expect((await readLines(context) as { lines: unknown[] }).lines).toHaveLength(1)
  })
})
