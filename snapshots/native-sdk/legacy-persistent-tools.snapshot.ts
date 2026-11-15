/** Recorded SDK persistent-tools turn replayed through the shipped dsh --profile sdk. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/persistent-tools')
const fixture = join(scene, 'session.v3.jsonl')
const expectedNote = join(scene, 'workspace.expected/note.txt')
const sessionId = 'sdk-legacy-persistent-tools'
const RESET = 'The persistent bash shell was reset; the next bash call starts from the workspace with a fresh current directory and environment.'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK persistent tools: recorded ${kind} has no text`)
  return block.text
}

function persistedEvents(sessions: string): { type: string; data: Record<string, unknown> }[] {
  let names: string[]
  try {
    names = readdirSync(sessions, { recursive: true }).map(String).filter(name => name.endsWith('session.v3.jsonl'))
  } catch {
    // The server can exit before creating the session directory.
    return []
  }
  return names.flatMap(name => readFileSync(join(sessions, name), 'utf8').split('\n').filter(line => line.length > 0)
    .map(line => JSON.parse(line) as { type: string; data: Record<string, unknown> }))
}

function resultText(event: { readonly data: Record<string, unknown> }): string {
  const message = event.data.message
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  const toolResult = Array.isArray(content) ? content[0] as { content?: unknown } : undefined
  const block = Array.isArray(toolResult?.content) ? toolResult.content[0] as { text?: unknown } : undefined
  return typeof block?.text === 'string' ? block.text : ''
}

it('replays the recorded SDK persistent-tools turn through dsh --profile sdk', async () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-persistent-')))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const profile = join(home, 'profiles', 'sdk')
  const patch = join(home, 'model.patch.json')
  const hydrated = join(home, 'hydrated.v3.jsonl')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  const replayCwd = workspace.replaceAll('\\', '/')
  writeFileSync(hydrated, readFileSync(fixture, 'utf8').replaceAll('{{cwd}}', JSON.stringify(replayCwd).slice(1, -1)))
  const recorded = parseSessionLog(readFileSync(hydrated, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const input = inputs[0]
  if (inputs.length !== 1 || input?.type !== 'user/message') throw new Error('legacy SDK persistent tools: expected one user task')
  const answer = recorded.find(event => event.type === 'assistant/message'
    && event.data.message.content.some(block => block.type === 'text'))
  if (answer?.type !== 'assistant/message') throw new Error('legacy SDK persistent tools: recorded reply missing')
  const task = textBlock(input.data.content, 'task')
  const reply = textBlock(answer.data.message.content, 'reply')

  const replayEntry = pathToFileURL(join(root, 'rsh/Tests/test-support/llm-replay/lib/native.js')).href
  mkdirSync(join(profile, 'node_modules', 'native-sdk-llm-replay'), { recursive: true })
  writeFileSync(join(profile, 'node_modules', 'native-sdk-llm-replay', 'package.json'), JSON.stringify({
    name: 'native-sdk-llm-replay', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(profile, 'node_modules', 'native-sdk-llm-replay', 'native.mjs'), `export { plugin } from '${replayEntry}'\n`)
  // The product editor has no Native entry. This stand-in accepts the recorded null placeholders and writes the workspace file.
  const editorDir = join(profile, 'node_modules', 'snapshot-str-replace-editor')
  mkdirSync(editorDir, { recursive: true })
  writeFileSync(join(editorDir, 'package.json'), JSON.stringify({
    name: 'snapshot-str-replace-editor', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['tools'], optional: [], provides: [] } },
  }))
  writeFileSync(join(editorDir, 'native.mjs'), [
    "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
    "import { dirname } from 'node:path'",
    'const nullable = { oneOf: [{ type: "string" }, { type: "null" }] }',
    'export const plugin = {',
    '  apiVersion: 1, name: "snapshot-str-replace-editor", targets: ["host"],',
    '  requires: ["tools"], optional: [], provides: [],',
    '  resolve() {',
    '    return (context) => {',
    '      context.effect(context.require("tools").registerValueTool({',
    '        schema: {',
    '          name: "str_replace_editor",',
    '          description: "Snapshot-local stand-in for the recorded editor calls.",',
    '          parameters: {',
    '            type: "object", additionalProperties: false, required: ["command", "path"],',
    '            properties: {',
    '              command: { type: "string" }, path: { type: "string" },',
    '              file_text: nullable, old_str: nullable, new_str: nullable,',
    '              insert_line: { type: "null" }, view_range: { type: "null" },',
    '            },',
    '          },',
    '        },',
    '        output: {',
    '          schema: { type: "string" },',
    '          render: (_call, value) => ({ isError: false, content: [{ type: "text", text: String(value) }] }),',
    '        },',
    '        async execute(call) {',
    '          const args = call.arguments',
    '          const path = args.path',
    '          if (args.command === "create") {',
    '            mkdirSync(dirname(path), { recursive: true })',
    '            writeFileSync(path, args.file_text ?? "")',
    '            return "created"',
    '          }',
    '          if (args.command === "view") return readFileSync(path, "utf8")',
    '          if (args.command === "str_replace") {',
    '            const text = readFileSync(path, "utf8")',
    '            if (typeof args.old_str !== "string" || !text.includes(args.old_str)) {',
    '              throw new Error("snapshot editor: old_str not found")',
    '            }',
    '            writeFileSync(path, text.replace(args.old_str, args.new_str ?? ""))',
    '            return "edited"',
    '          }',
    '          throw new Error("snapshot editor: unknown command " + String(args.command))',
    '        },',
    '      }, context.scope))',
    '    }',
    '  },',
    '}',
    '',
  ].join('\n'))
  const composition = shippedNativeProfileComposition(home, 'sdk')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-persistent-tools',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: [
      ...composition.installations.map(row => row.id === 'pi-ai' ? {
        id: 'pi-ai', plugin: 'native-sdk-llm-replay', scope: row.scope,
        config: { file: hydrated, providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }] },
      } : row),
      { id: 'str-replace-editor', plugin: 'snapshot-str-replace-editor', scope: 'root' },
    ],
  }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'You are a helpful coding assistant.', maxSteps: 12 } },
    { id: 'storage', config: { root: sessions, compression: 'none' } },
    { id: 'fs', config: { cwd: workspace } },
  ] }))
  const harness = new RedSparkHarness({
    rshBin: join(root, 'rsh/Programs/CLI/lib/bin.js'),
    rshHome: home,
    patches: [patch],
    cwd: workspace,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    env: { ...process.env, RSH_TELEMETRY_DISABLED: '1' },
    requestTimeoutMs: 80_000,
  })
  try {
    const result = await harness.session(sessionId).run(task)
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const events = persistedEvents(sessions)
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual([
      'bash', 'bash', 'bash', 'str_replace_editor', 'str_replace_editor', 'str_replace_editor', 'bash',
    ])
    const bash = events.filter(event => event.type === 'tool/result'
      && (event.data.message as { source?: { callId?: string } } | undefined)?.source?.callId !== undefined)
      .map(resultText)
    const bashText = events.filter(event => event.type === 'tool/result').map(resultText).join('\n')
    expect(bashText).toContain('COUNT=1 CWD=/tmp')
    expect(bashText).toContain('COUNT=2 CWD=/tmp')
    expect(bashText).toContain('delayed')
    expect(bashText).toContain('[shell exited: code 9]')
    expect(bashText).toContain(RESET)
    expect(readFileSync(join(workspace, 'note.txt'))).toEqual(readFileSync(expectedNote))
    expect(bash.length).toBeGreaterThan(0)
  } finally {
    await harness.close()
    rmSync(home, { recursive: true, force: true })
  }
}, 90_000)
