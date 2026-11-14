/** Recorded SDK ptc turn replayed through the shipped dsh --profile sdk. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { RedSparkHarness } from '@redspark/rsh-sdk-client'
import { parseSessionLog } from '@redspark/rsh-llm-replay'
import { shippedNativeProfileComposition } from '../../rsh/Programs/CLI/src/native-profile-template.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/sdk/ptc-turn')
const fixture = join(scene, 'session.v3.jsonl')
const sessionId = 'sdk-legacy-ptc'

function textBlock(content: readonly { readonly type: string; readonly text?: string }[], kind: string): string {
  const block = content.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.length > 0)
  if (block?.text === undefined) throw new Error(`legacy SDK ptc: recorded ${kind} has no text`)
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

it('replays the recorded SDK ptc turn through dsh --profile sdk', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inputs = recorded.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const input = inputs[0]
  if (inputs.length !== 1 || input?.type !== 'user/message') throw new Error('legacy SDK ptc: expected one user task')
  const answer = recorded.find(event => event.type === 'assistant/message'
    && event.data.message.content.some(block => block.type === 'text'))
  if (answer?.type !== 'assistant/message') throw new Error('legacy SDK ptc: recorded reply missing')
  const task = textBlock(input.data.content, 'task')
  const reply = textBlock(answer.data.message.content, 'reply')

  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-legacy-sdk-ptc-')))
  const workspace = join(home, 'workspace')
  const sessions = join(home, 'sessions')
  const profile = join(home, 'profiles', 'sdk')
  const patch = join(home, 'model.patch.json')
  mkdirSync(workspace)
  mkdirSync(profile, { recursive: true })
  const replayEntry = pathToFileURL(join(root, 'rsh/Tests/test-support/llm-replay/lib/native.js')).href
  mkdirSync(join(profile, 'node_modules', 'native-sdk-llm-replay'), { recursive: true })
  writeFileSync(join(profile, 'node_modules', 'native-sdk-llm-replay', 'package.json'), JSON.stringify({
    name: 'native-sdk-llm-replay', version: '0.0.0', type: 'module',
    exports: { './native': './native.mjs', './package.json': './package.json' },
    dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: [], optional: [], provides: ['model'] } },
  }))
  writeFileSync(join(profile, 'node_modules', 'native-sdk-llm-replay', 'native.mjs'), `export { plugin } from '${replayEntry}'\n`)
  const composition = shippedNativeProfileComposition(home, 'sdk')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'legacy-sdk-ptc',
    private: true,
    dsh: { profile: { runtime: 'native', config: 'rsh.profile.json' } },
  }))
  // The shipped profile's bash tool is the persistent shell. This program reads the one-shot stdout.text result.
  writeFileSync(join(profile, 'rsh.profile.json'), JSON.stringify({
    ...composition,
    installations: [
      ...composition.installations.map(row => {
        if (row.id === 'pi-ai') return {
          id: 'pi-ai', plugin: 'native-sdk-llm-replay', scope: row.scope,
          config: { file: fixture, providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }] },
        }
        if (row.id === 'persistent-bash') return { ...row, disabled: true }
        return row
      }),
      { id: 'bash-local', plugin: '@redspark/rsh-bash-local', scope: 'root' },
      { id: 'shell-env', plugin: '@redspark/rsh-shell-env', scope: 'root' },
      { id: 'tool-bash', plugin: '@redspark/rsh-tool-bash', scope: 'root' },
      { id: 'code-runtime', plugin: '@redspark/rsh-native-code-runtime', scope: 'root' },
      { id: 'tool-code-runtime', plugin: '@redspark/rsh-tool-code-runtime', scope: 'root' },
    ],
  }))
  writeFileSync(patch, JSON.stringify({ formatVersion: 1, installations: [
    { id: 'app', config: { systemPrompt: 'You are a helpful coding assistant.', maxSteps: 4 } },
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
    requestTimeoutMs: 40_000,
  })
  try {
    const result = await harness.session(sessionId).run(task)
    expect(result.finalResponse).toBe(reply)
    expect(result.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    const events = persistedEvents(sessions)
    expect(events.filter(event => event.type === 'tool/call').map(event => event.data.name)).toEqual(['run_code'])
    const dispatch = events.filter(event => event.type === 'tool/ptc-dispatch')
    expect(dispatch.map(event => event.data.name)).toEqual(['bash', 'bash'])
    expect(dispatch.every(event => event.data.isError === false)).toBe(true)
    const commands = dispatch.map(event => {
      const args = event.data.arguments
      return typeof args === 'object' && args !== null ? (args as { command?: unknown }).command : undefined
    })
    expect(commands).toEqual(['echo CODE_ONE', 'echo CODE_TWO'])
    expect(events.filter(event => event.type === 'tool/result').map(resultText).join('\n')).toContain('CODE_ONE+CODE_TWO')
  } finally {
    await harness.close()
    rmSync(home, { recursive: true, force: true })
  }
}, 60_000)
