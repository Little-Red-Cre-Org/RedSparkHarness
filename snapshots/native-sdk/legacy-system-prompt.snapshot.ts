/** Recorded SDK in-history prompt turn replayed through the shipped dsh --profile sdk. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/system-prompt-in-history')
const fixture = join(scene, 'session.v3.jsonl')
const override = join(scene, 'replay.override.json')
const sessionId = 'sdk-legacy-system-prompt'
const GUIDANCE = 'Snapshot guidance added after the first read'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK system prompt: recorded ${kind} has no text`)
  return block.text
}

function systemText(event: { readonly data: Record<string, unknown> }): string {
  const message = event.data.message
  if (typeof message !== 'object' || message === null) throw new Error('legacy SDK system prompt: system message missing')
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content) || content[0]?.type !== 'text' || typeof content[0].text !== 'string') {
    throw new Error('legacy SDK system prompt: system message has no text')
  }
  return content[0].text
}

function persistedEvents(sessions: string): { type: string; surfaceOp?: unknown; data: Record<string, unknown> }[] {
  let names: string[]
  try {
    names = readdirSync(sessions, { recursive: true }).map(String).filter(name => name.endsWith('session.v3.jsonl'))
  } catch {
    // The server can exit before creating the session directory.
    return []
  }
  return names.flatMap(name => readFileSync(join(sessions, name), 'utf8').split('\n').filter(line => line.length > 0)
    .map(line => JSON.parse(line) as { type: string; surfaceOp?: unknown; data: Record<string, unknown> }))
}

function writePackage(directory: string, manifest: unknown, source: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(directory, 'native.mjs'), source)
}

it('replays the recorded SDK in-history prompt through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const input = inputs[0]
  if (inputs.length !== 1 || input?.type !== 'user/message') throw new Error('legacy SDK system prompt: expected one user task')
  const answer = recorded.find(event => event.type === 'assistant/message'
    && event.data.message.content[0]?.type === 'text')
  if (answer?.type !== 'assistant/message') throw new Error('legacy SDK system prompt: recorded reply missing')
  const task = textBlock(input.data.content, 'task')
  const reply = textBlock(answer.data.message.content, 'reply')

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-prompt-')))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const profile = join(home, 'profiles', 'sdk')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(workspace, 'task.txt'), readFileSync(join(scene, 'workspace/task.txt')))
  const replayEntry = pathToFileURL(join(root, 'rsh/Tests/test-support/llm-replay/lib/native.js')).href
  writePackage(join(profile, 'node_modules', 'native-sdk-llm-replay'), {
    name: 'native-sdk-llm-replay', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }, `export { plugin } from '${replayEntry}'\n`)
  writePackage(join(profile, 'node_modules', 'native-in-history-prompt-update'), {
    name: 'native-in-history-prompt-update', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'],
      requires: ['promptSections', 'tools'], optional: [], provides: [] } },
  }, [
    'let guidance = \'\'',
    'export const plugin = {',
    "  apiVersion: 1, name: 'native-in-history-prompt-update', targets: ['host'],",
    "  requires: ['promptSections', 'tools'], provides: [],",
    '  resolve: () => context => {',
    "    const sections = context.require('promptSections')",
    "    const tools = context.require('tools')",
    '    context.effect(sections.register({',
    "      name: 'snapshot:in-history-update', order: 400, text: () => guidance,",
    '    }))',
    '    context.effect(tools.interceptAfterCall((facts) => {',
    "      if (facts.name === 'read' && !facts.result.isError) {",
    "        guidance = 'Snapshot guidance added after the first read: reply with the single word DONE.'",
    '      }',
    "      return { kind: 'pass' }",
    '    }))',
    '  },',
    '}',
    '',
  ].join('\n'))
  const composition = shippedNativeProfileComposition(home, 'sdk')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-system-prompt',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  // The shipped profile has no file tools, and pi-ai does not declare in-history updates.
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: [
      ...composition.installations.map(row => row.id === 'pi-ai' ? {
        id: 'pi-ai', plugin: 'native-sdk-llm-replay', scope: row.scope,
        config: { file: fixture, overrideFile: override, providers: [{ id: 'fixture', models: [{
          id: 'fixture-model', systemPromptUpdate: 'in-history',
        }] }] },
      } : row),
      { id: 'policy', plugin: '@redspark/rsh-fs-observation-policy', scope: 'root' },
      { id: 'file-tools', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
      { id: 'in-history-prompt-update', plugin: 'native-in-history-prompt-update', scope: 'root' },
    ],
  }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'Reply to the recorded SDK task.', maxSteps: 4 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'fs', config: { cwd: workspace } },
  ] }))
  const harness = new RedSparkHarness({
    rshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'),
    rshHome: home,
    patches: [patch],
    cwd: workspace,
    provider: 'fixture',
    model: 'fixture-model',
    env: { ...process.env, RSH_TELEMETRY_DISABLED: '1' },
    requestTimeoutMs: 20_000,
  })
  try {
    const result = await harness.session(sessionId).run(task)
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const events = persistedEvents(sessions)
    const systems = events.filter(event => event.type === 'system/message')
    expect(systems.map(event => event.surfaceOp)).toEqual(['append', 'append'])
    const prompts = systems.map(systemText)
    expect(prompts[0]).not.toContain(GUIDANCE)
    expect(prompts[1]).toContain(GUIDANCE)
    expect(prompts[1]).not.toBe(prompts[0])
    const second = systems[1]
    if (second === undefined) throw new Error('legacy SDK system prompt: second system message missing')
    expect(events.indexOf(second)).toBeGreaterThan(events.findIndex(event => event.type === 'tool/result'))
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['read'])
    expect(events.filter(event => event.type === 'request/header')).toHaveLength(1)
  } finally {
    await harness.close()
    rmSync(home, { recursive: true, force: true })
  }
}, 30_000)
