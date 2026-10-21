/** Archify artifacts must survive validation failure and use the ordinary delivery event. */

import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as Present from '@deepseek-ai/dsh-tool-present'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as Archify from '@deepseek-ai/dsh-archify'

const require = createRequire(import.meta.url)
const archifyPackage = require.resolve('@tt-a1i/archify-dsh/package.json')
const archifyRoot = join(dirname(archifyPackage), 'skills', 'archify')
const archifyBin = join(archifyRoot, 'bin', 'archify.mjs')
const example = join(archifyRoot, 'examples', 'web-app.architecture.json')
const cleanups: Array<() => Promise<unknown>> = []
let callNumber = 0

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

async function testDirectory(): Promise<string> {
  const parent = join(tmpdir(), 'dsh-archify-中文 空格')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(join(parent, 'case-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function archify(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [archifyBin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

async function testAgent(ctx: Context, cwd: string): Promise<Agent> {
  const id = SessionId(`archify-present-${++callNumber}`)
  let scope!: Scope
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    cwd,
    isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    get ctx() { return scope.ctx },
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, value) }, { inject: ['tools'] }))
  ctx.agents.register(value)
  return value
}

describe('Archify integration', () => {
  it('executes the supplied shell examples from a different Unicode workspace', async () => {
    const root = await testDirectory()
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ShellEnv)
    await ctx.plugin(Archify)
    const definition = await ctx.skills.get('archify', { cwd: root })
    const body = definition!.content
    const resources = [...body.matchAll(/^- ((?:schemas|examples)\/[^\r\n]+\.json)$/gm)].map(match => match[1]!)
    expect(resources).toContain('schemas/common.schema.json')
    expect(resources).toContain('examples/agent-run.lifecycle.json')
    for (const resource of resources) {
      const content = await readFile(join(archifyRoot, resource), 'utf8')
      expect(() => { JSON.parse(content) }).not.toThrow()
    }
    await mkdir(join(root, 'output'))
    await writeFile(join(root, 'output', 'candidate.json'), await readFile(example))
    const language = process.platform === 'win32' ? 'powershell' : 'bash'
    const commands = body.split('```' + language + '\n')[1]!.split('```')[0]!.trim().split('\n')
    for (const command of commands) {
      const result = spawnSync(process.platform === 'win32' ? 'pwsh' : 'bash',
        process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command], {
          cwd: root,
          encoding: 'utf8',
          timeout: 30_000,
          env: { ...process.env, ...ctx.shellEnv.collect({} as never), ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
        })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr || result.stdout).toBe(0)
      if (command.includes(' deliver ')) {
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, validation: { checksPassed: 9, errors: 0, warnings: 0 } })
      }
    }
    expect(await readFile(join(root, 'output', 'diagram.html'), 'utf8')).toContain('<svg')
  }, 60_000)

  it('discovers and unloads the pinned Archify Skill through its built-in provider', async () => {
    const cwd = await testDirectory()
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ShellEnv)
    const provider = await ctx.plugin(Archify)

    const matches = (await ctx.skills.list({ cwd })).filter(skill => skill.name === 'archify')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      provider: 'archify',
      invocation: { modelInvocable: false, userInvocable: true },
    })
    const definition = await ctx.skills.get('archify', { cwd })
    expect(definition?.provider).toBe('archify')
    expect(definition?.content).toContain('node bin/archify.mjs deliver')

    await provider.dispose()
    expect((await ctx.skills.list({ cwd })).some(skill => skill.name === 'archify')).toBe(false)
  })

  it('generates showcase JSON and HTML in a Unicode path and records both through present', async () => {
    const root = await testDirectory()
    const specification = join(root, 'RSH 集成方案.json')
    const artifact = join(root, 'RSH 方案设计图.html')
    await writeFile(specification, await readFile(example))

    const delivered = archify('deliver', 'architecture', specification, artifact, '--quality', 'showcase', '--json')
    expect(delivered.status, delivered.stderr || delivered.stdout).toBe(0)
    const receipt = JSON.parse(delivered.stdout) as {
      ok?: boolean
      validation?: { checksPassed?: number; errors?: number; warnings?: number }
    }
    expect(receipt).toMatchObject({
      ok: true,
      validation: { checksPassed: 9, errors: 0, warnings: 0 },
    })
    expect((await readFile(artifact, 'utf8'))).toContain('<svg')

    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    await ctx.plugin(Present, { maxFiles: 2 })
    const owner = await testAgent(ctx, root)
    owner.session.append('turn/start', { turn: 1 })
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId(`archify-call-${++callNumber}`),
      name: 'present',
      arguments: {
        files: [
          { path: 'RSH 集成方案.json', description: 'Validated Archify specification' },
          { path: 'RSH 方案设计图.html', description: 'Interactive architecture diagram' },
        ],
      },
      agent: owner,
    })
    expect(result.isError).toBe(false)
    expect(owner.session.snapshotEvents().find(event => event.type === 'deliverables/presented')?.data.files).toEqual([
      { path: 'RSH 集成方案.json', description: 'Validated Archify specification' },
      { path: 'RSH 方案设计图.html', description: 'Interactive architecture diagram' },
    ])
  })

  it('keeps the candidate and existing output when delivery validation fails', async () => {
    const root = await testDirectory()
    const candidate = join(root, '待修复.json')
    const artifact = join(root, '已存在.html')
    await writeFile(candidate, '{"meta":{"quality_profile":"showcase"}}\n')
    await writeFile(artifact, 'KEEP_EXISTING_OUTPUT\n')

    const delivered = archify('deliver', 'architecture', candidate, artifact, '--quality', 'showcase', '--json')
    expect(delivered.status).toBe(1)
    expect(JSON.parse(delivered.stdout)).toMatchObject({ ok: false, stage: 'render' })
    expect(await readFile(candidate, 'utf8')).toContain('quality_profile')
    expect(await readFile(artifact, 'utf8')).toBe('KEEP_EXISTING_OUTPUT\n')
  })
})
