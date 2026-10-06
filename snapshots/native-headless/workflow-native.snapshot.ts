/** Shipped native-headless profile replays Workflow fan-out and a structured Ralph round. */
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session/native'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizeSessionSnapshot, redactSessionSnapshotIds,
  normalizedSystemPrompts, normalizedToolSchemas, sessionFixtureName } from '@deepseek-ai/dsh-session-snapshot'
import { toolCallResponse, textResponse } from '../../rsh/Engine/core/agent-loop/tests/mock-adapter.ts'
import { ensureShippedNativeProfile, shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/native-headless/workflow-native')
const roleNames = Array.from({ length: 4 }, (_, index) => join(scene, sessionFixtureName(index, SESSION_FORMAT_VERSION)))
const task = 'Run a two-child workflow and one structured Ralph round.'
const workflowScript = "const first = await agent('inspect first item'); const second = await agent('inspect second item'); return { results: [first, second] }"
const report = { status: 'complete', summary: 'workspace inspected', evidence: ['README.md exists'], nextSteps: [], blocker: '' }

function fixtureEntries(): { readonly task: string; readonly parent: ReturnType<typeof deriveReplayScript>; readonly children: Array<{ match: string; script: ReturnType<typeof deriveReplayScript> }> } | undefined {
  if (!roleNames.every(path => lstatExists(path))) return undefined
  const logs = roleNames.map(path => readFileSync(path, 'utf8'))
  const parsed = logs.map(parseSessionLog)
  const parentEvents = parsed[0]
  if (parentEvents === undefined) throw new Error('workflow-native: missing parent Session')
  const initial = parentEvents.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const userTask = initial?.type === 'user/message' ? initial.data.content.find(block => block.type === 'text') : undefined
  if (userTask?.type !== 'text') throw new Error('workflow-native: missing recorded task')
  const children = parsed.slice(1).map(events => {
    const first = events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    const prompt = first?.type === 'user/message' ? first.data.content.find(block => block.type === 'text') : undefined
    if (prompt?.type !== 'text') throw new Error('workflow-native: child Session has no prompt')
    const match = prompt.text.split('\n', 1)[0]
    if (match === undefined || match.length === 0) throw new Error('workflow-native: child prompt has no first line')
    return { match, script: deriveReplayScript(events) }
  })
  return { task: userTask.text, parent: deriveReplayScript(parentEvents), children }
}

function lstatExists(path: string): boolean {
  try { return lstatSync(path).isFile() } catch { return false }
}

function initialEntries() {
  return {
    task,
    parent: [
      { kind: 'chunks' as const, chunks: toolCallResponse('workflow-run', 'workflow', {
        meta: { name: 'two-item-review', description: 'inspect two independent items' }, script: workflowScript,
      }) },
      { kind: 'chunks' as const, chunks: toolCallResponse('ralph-run', 'ralph', { objective: 'inspect the workspace', maxRounds: 1 }) },
      { kind: 'chunks' as const, chunks: textResponse('Workflow and Ralph reports completed.') },
    ],
    children: [
      { match: 'inspect first item', script: [{ kind: 'chunks' as const, chunks: textResponse('first item inspected') }] },
      { match: 'inspect second item', script: [{ kind: 'chunks' as const, chunks: textResponse('second item inspected') }] },
      { match: 'You are one fresh worker in a foreground Ralph loop.', script: [
        { kind: 'chunks' as const, chunks: toolCallResponse('structured-report', 'structured_output', report) },
      ] },
    ],
  }
}

it('replays real workflow children and a committed structured report through dsh', async () => {
  const saved = process.env.DSH_SNAPSHOT === 'refresh' ? undefined : fixtureEntries()
  const responses = saved ?? initialEntries()
  const home = mkdtempSync(join(tmpdir(), 'dsh-workflow-native-'))
  const profile = join(home, 'profiles/native-headless')
  const modules = join(profile, 'node_modules')
  const workspace = join(home, 'work')
  const sessions = join(home, 'sessions')
  const links: string[] = []
  try {
    ensureShippedNativeProfile('native-headless', home)
    mkdirSync(join(modules, '@deepseek-ai'), { recursive: true })
    mkdirSync(workspace)
    const packages = [
      ['native-headless', 'rsh/Engine/core/native-headless'],
      ['native-agent', 'rsh/Engine/core/native-agent'],
      ['native-session-execution', 'rsh/Engine/core/native-session-execution'],
      ['native-model-execution', 'rsh/Engine/core/native-model-execution'],
      ['native-tools', 'rsh/Engine/core/native-tools'],
      ['native-prompt', 'rsh/Engine/core/native-prompt'],
      ['native-subagent', 'rsh/Engine/subagent/native-subagent'],
      ['workflow', 'rsh/Engine/workflow/workflow'],
      ['workflow-worker-thread', 'rsh/Engine/workflow/workflow-worker-thread'],
      ['tool-workflow', 'rsh/Engine/workflow/tool-workflow'],
      ['tool-ralph', 'rsh/Engine/workflow/tool-ralph'],
      ['session-persistence-jsonl', 'rsh/Engine/session/session-persistence-jsonl'],
      ['fs-local', 'rsh/Modules/Official/fs/fs-local'],
    ] as const
    for (const [name, path] of packages) {
      const link = join(modules, '@deepseek-ai', `dsh-${name}`)
      symlinkSync(join(root, path), link, 'junction')
      links.push(link)
    }
    const model = join(modules, 'workflow-fixture-model')
    mkdirSync(model)
    writeFileSync(join(model, 'package.json'), JSON.stringify({ name: 'workflow-fixture-model', type: 'module',
      exports: { './native': './native.mjs', './package.json': './package.json' },
      dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
    }))
    writeFileSync(join(model, 'native.mjs'), `export const plugin = {
      apiVersion: 1, name: 'workflow-fixture-model', targets: ['host'], requires: [], provides: ['model'],
      resolve(input) {
        const parent = structuredClone(input.parent);
        const children = structuredClone(input.children);
        return context => {
          let parentIndex = 0;
          const childIndices = new Map();
          context.provide('model', { async *stream(request) {
            const messages = JSON.stringify(request.messages);
            const delegated = messages.includes('You are a delegated subagent:');
            if (delegated) {
              const child = children.find(row => messages.includes(row.match));
              if (child === undefined) throw new Error('workflow-native: no recorded child prompt matches this request');
              const index = childIndices.get(child.match) ?? 0;
              childIndices.set(child.match, index + 1);
              const entry = child.script[index];
              if (entry?.kind !== 'chunks') throw new Error('workflow-native: child replay exhausted');
              for (const chunk of entry.chunks) yield chunk;
              return;
            }
            const entry = parent[parentIndex++];
            if (entry?.kind !== 'chunks') throw new Error('workflow-native: parent replay exhausted');
            for (const chunk of entry.chunks) yield chunk;
          } });
        };
      },
    };`)

    const composition = shippedNativeProfileComposition(home, 'native-headless')
    const selected = new Set(['app', 'agents', 'session-execution', 'tools', 'prompt', 'subagents', 'workflow',
      'workflow-worker', 'workflow-tool', 'ralph-tool', 'model-execution', 'storage', 'fs', 'pi-ai'])
    const installations = composition.installations.map(row => {
      if (!selected.has(row.id)) return { ...row, disabled: true }
      if (row.id === 'app') return { ...row, config: { provider: 'fixture', model: 'native-workflow',
        systemPrompt: 'Use the requested orchestration tool.', maxSteps: 4, cwd: workspace } }
      if (row.id === 'fs') return { ...row, plugin: '@deepseek-ai/dsh-fs-local', config: { cwd: workspace } }
      if (row.id === 'storage') return { ...row, config: { root: sessions, compression: 'none' } }
      if (row.id === 'pi-ai') return { ...row, plugin: 'workflow-fixture-model', config: responses }
      return row
    })
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations }))

    const child = await execa(process.execPath, ['--import', pathToFileURL(join(root,
      'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', responses.task],
    { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 60_000 })
    expect(child.exitCode, child.stderr).toBe(0)
    expect(child.stdout).toContain('Workflow and Ralph reports completed.')

    const stored = readdirSync(sessions, { recursive: true }).filter(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
      .map(name => readFileSync(join(sessions, String(name)), 'utf8'))
    expect(stored).toHaveLength(4)
    const parentIndex = stored.findIndex(raw => parseSessionLog(raw).some(event => event.type === 'tool-workflow/run-start'))
    if (parentIndex < 0) throw new Error('workflow-native: durable parent Session missing')
    const parentRaw = stored[parentIndex]
    if (parentRaw === undefined) throw new Error('workflow-native: parent Session is missing')
    const parentEvents = parseSessionLog(parentRaw)
    const starts = parentEvents.filter(event => event.type === 'tool-workflow/agent-start')
    expect(starts).toHaveLength(3)
    expect(parentEvents.filter(event => event.type === 'tool-workflow/run-start').map(event => event.data.name))
      .toEqual(['two-item-review', 'ralph-loop'])
    expect(parentEvents.filter(event => event.type === 'tool-workflow/agent-end').map(event => event.data.outcome))
      .toEqual(['completed', 'completed', 'completed'])
    expect(parentEvents.filter(event => event.type === 'tool-workflow/run-end').map(event => event.data.stopReason))
      .toEqual(['completed', 'completed'])
    expect(parentEvents.some(event => event.type === 'tool/result' && JSON.stringify(event).includes('Ralph worker reported completion'))).toBe(true)
    const headers = stored.map(raw => JSON.parse(raw.split('\n')[0] ?? '{}') as { id?: string; parentSession?: string })
    const orderedChildren = starts.map(start => {
      const id = String(start.data.childId)
      const index = headers.findIndex(header => header.id === id)
      if (index < 0) throw new Error(`workflow-native: durable child ${id} missing`)
      return stored[index] as string
    })
    expect(orderedChildren).toHaveLength(3)
    for (const [index, raw] of orderedChildren.entries()) {
      const header = JSON.parse(raw.split('\n')[0] ?? '{}') as { parentSession?: string }
      expect(header.parentSession).toBe(headers[parentIndex]?.id)
      const events = parseSessionLog(raw)
      expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      if (index === 2) {
        expect(events).toContainEqual(expect.objectContaining({ type: 'tool/call', data: expect.objectContaining({ name: 'structured_output' }) }))
        expect(events.some(event => event.type === 'tool/result' && JSON.stringify(event).includes('"isError":false'))).toBe(true)
      }
    }

    const orderedRaw = [parentRaw, ...orderedChildren]
    const redacted = redactSessionSnapshotIds(orderedRaw)
    const context = { cwd: workspace, sessionIds: [] }
    const normalized = redacted.map(raw => normalizeSessionSnapshot(raw, context, { identityMode: 'preserve' }))
    const promptSnapshots = normalizedSystemPrompts(parentRaw, context)
    const schemaSnapshots = normalizedToolSchemas(parentRaw, context)
    if (promptSnapshots[0] === undefined || schemaSnapshots[0] === undefined) throw new Error('workflow-native: missing model request header')
    expect(JSON.stringify(schemaSnapshots)).toContain('"name":"workflow"')
    expect(JSON.stringify(schemaSnapshots)).toContain('"name":"ralph"')
    const outputs = [
      ...normalized.map((raw, index) => [roleNames[index] as string, raw] as const),
      [join(scene, 'system-prompt.expected.md'), formatSystemPromptSnapshot(promptSnapshots[0], promptSnapshots.slice(1))] as const,
      [join(scene, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(schemaSnapshots[0], schemaSnapshots.slice(1))] as const,
    ]
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      for (const [path, content] of outputs) writeFileSync(path, content)
    } else {
      for (const [path, content] of outputs) expect(content).toBe(readFileSync(path, 'utf8'))
    }

    const parallelResponses = {
      task: 'Run the parallel profile smoke.',
      parent: [
        { kind: 'chunks' as const, chunks: toolCallResponse('parallel-run', 'workflow', {
          meta: { name: 'parallel-profile-smoke', description: 'run two independent children' },
          script: "return await parallel([() => agent('parallel child one'), () => agent('parallel child two')])",
        }) },
        { kind: 'chunks' as const, chunks: textResponse('Parallel profile smoke completed.') },
      ],
      children: [
        { match: 'parallel child one', script: [{ kind: 'chunks' as const, chunks: textResponse('first child completed') }] },
        { match: 'parallel child two', script: [{ kind: 'chunks' as const, chunks: textResponse('second child completed') }] },
      ],
    }
    const parallelInstallations = installations.map(row => row.id === 'pi-ai'
      ? { ...row, config: parallelResponses } : row)
    writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({ ...composition, installations: parallelInstallations }))
    const parallelProcess = await execa(process.execPath, ['--import', pathToFileURL(join(root,
      'rsh/Programs/CLI/tests/fixtures/deny-cordis-context-register.mjs')).href,
      join(root, 'rsh/Programs/CLI/lib/bin.js'), '--profile', 'native-headless', parallelResponses.task],
    { env: { ...process.env, DSH_HOME: home }, reject: false, timeout: 60_000 })
    expect(parallelProcess.exitCode, parallelProcess.stderr).toBe(0)
    const allSessions = readdirSync(sessions, { recursive: true })
      .filter(name => String(name).endsWith(sessionFixtureName(0, SESSION_FORMAT_VERSION)))
      .map(name => readFileSync(join(sessions, String(name)), 'utf8'))
    const parallelParent = allSessions.map(raw => ({ raw, events: parseSessionLog(raw) }))
      .find(entry => entry.events.some(event => event.type === 'tool-workflow/run-start'
        && event.data.name === 'parallel-profile-smoke'))
    if (parallelParent === undefined) throw new Error('workflow-native: parallel profile parent Session missing')
    const parentHeader = JSON.parse(parallelParent.raw.split('\n')[0] ?? '{}') as { id?: string }
    const parallelEvents = parallelParent.events
    const parallelStarts = parallelEvents.filter(event => event.type === 'tool-workflow/agent-start')
    expect(parallelStarts).toHaveLength(2)
    const childIds = parallelStarts.map(event => String(event.data.childId))
    expect(new Set(childIds).size).toBe(2)
    expect(parallelEvents.filter(event => event.type === 'tool-workflow/agent-end')
      .map(event => event.data.outcome).sort()).toEqual(['completed', 'completed'])
    expect(parallelEvents.find(event => event.type === 'tool-workflow/run-end'))
      .toMatchObject({ type: 'tool-workflow/run-end', data: { stopReason: 'completed' } })
    for (const childId of childIds) {
      const childRaw = allSessions.find(raw => JSON.parse(raw.split('\n')[0] ?? '{}').id === childId)
      if (childRaw === undefined) throw new Error(`workflow-native: parallel child ${childId} Session missing`)
      const childHeader = JSON.parse(childRaw.split('\n')[0] ?? '{}') as { parentSession?: string }
      expect(childHeader.parentSession).toBe(parentHeader.id)
      expect(parseSessionLog(childRaw).at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    }
  } finally {
    for (const link of links) if (!lstatSync(link).isSymbolicLink()) throw new Error('workflow-native: expected package link')
    for (const link of links) unlinkSync(link)
    const status = lstatSync(home)
    if (!status.isDirectory() || status.isSymbolicLink() || dirname(realpathSync(home)) !== realpathSync(tmpdir())) {
      throw new Error('workflow-native: unsafe temporary home')
    }
    rmSync(home, { recursive: true, force: true })
  }
})
