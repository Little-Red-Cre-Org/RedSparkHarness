/** Recorded pty-tools-sandbox-backend scenario replayed through a Native profile. */
import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/pty-tools-sandbox-backend')
// This scenario tracks the current writer, so its committed generation is both the
// replay input and the expected output.
const fixture = join(scene, 'session.v3.jsonl')

it('replays the recorded pty-tools-sandbox-backend session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const expected = recorded.map(event => event.type).filter(type => type !== 'session')
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('pty-tools-sandbox-backend: no recorded task')

  // The recording drove a POSIX shell. On Windows that shell is Git Bash, which the host
  // image provides but not at the recorded path, so resolve it rather than hardcode it.
  const shellPath = process.platform === 'win32'
    ? ['C:/Program Files/Git/bin/bash.exe'].find(candidate => existsSync(candidate)) : undefined
  if (process.platform === 'win32' && shellPath === undefined) {
    throw new Error('pty-tools-sandbox-backend: a POSIX shell is required and none was found')
  }

  const scenario = assembleNativeScenario({
    root,
    scene,
    modules: [
      { name: 'rsh-permission-presets', path: 'rsh/Modules/Official/interaction/permission-presets' },
      { name: 'rsh-session-title', path: 'rsh/Engine/session/session-title' },
      { name: 'rsh-native-approval', path: 'rsh/Modules/Official/interaction/native-approval' },
      { name: 'rsh-native-sandbox-policy', path: 'rsh/Modules/Official/sandbox/native-sandbox-policy' },
      { name: 'rsh-native-session-execution', path: 'rsh/Engine/core/native-session-execution' },
      { name: 'rsh-native-prompt', path: 'rsh/Engine/core/native-prompt' },
      { name: 'rsh-bash-local', path: 'rsh/Modules/Official/shell/bash-local' },
      { name: 'rsh-subprocess', path: 'rsh/Core/subprocess/subprocess' },
      { name: 'rsh-subprocess-local', path: 'rsh/Core/subprocess/subprocess-local' },
      { name: 'rsh-shell-env', path: 'rsh/Modules/Official/shell/shell-env' },
      { name: 'rsh-terminal', path: 'rsh/Modules/Official/terminal/terminal' },
      { name: 'rsh-terminal-bash', path: 'rsh/Modules/Official/terminal/terminal-bash' },
      { name: 'rsh-tool-terminal', path: 'rsh/Modules/Official/terminal/tool-terminal' },
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      // Native mutation tools ask their authority once per attempt; the recording ran with
      // prompts disabled, so an answerer grants without reaching a person.
      {
        name: 'native-pty-tools-sandbox-backend-approval',
        files: {
          'package.json': JSON.stringify({
            name: 'native-pty-tools-sandbox-backend-approval', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['approval'], optional: [], provides: [] } },
          }),
          'native.mjs': [
            'export const plugin = {',
            "  apiVersion: 1, name: 'native-pty-tools-sandbox-backend-approval', targets: ['host'],",
            "  requires: ['approval'], provides: [],",
            '  resolve: () => context => {',
            "    const approval = context.require('approval')",
            "    context.effect(approval.registerAnswerer(() => 'allowed-once'))",
            '  },',
            '}',
          ].join('\n'),
        },
      },
    ],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { cwd: paths.workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
          systemPrompt: 'Use the read and write tools.', maxSteps: 6 } }
      }
      // The terminal tools send background work, so the Jobs rows stay enabled.
      if (['code-runtime', 'time-context'].includes(row.id)) return { ...row, disabled: true }
      if (row.id === 'jobs' || row.id === 'tool-jobs') return { ...row, disabled: false }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: 'root' },
      { id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'danger-full-access', workspaceRoot: paths.workspace } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      // The recording ran with prompts disabled; Native mutation tools ask their authority
      // once per attempt, so an answerer grants without reaching a person.
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'never' } },
      // The recorded removal runs through the bash tool.
      { id: 'bash-local', plugin: '@redspark/rsh-bash-local', scope: 'root' },
      { id: 'subprocess-local', plugin: '@redspark/rsh-subprocess-local', scope: 'root' },
      { id: 'shell-env', plugin: '@redspark/rsh-shell-env', scope: 'root' },
      // The recorded turn drives a persistent PTY through the terminal tools.
      { id: 'terminals', plugin: '@redspark/rsh-terminal', scope: 'root', config: {} },
      // The recorded composition pins tight PTY timings so the scenario is deterministic.
      { id: 'terminal-bash', plugin: '@redspark/rsh-terminal-bash', scope: 'root', config: {
        type: 'shell', ...shellPath === undefined ? {} : { shellPath }, pollIntervalMs: 10, exactProbeAfterMs: 20, idleSilenceMs: 250,
        handoffGraceMs: 250, timeoutMs: 2000, graceMs: 500,
      } },
      { id: 'tool-terminal', plugin: '@redspark/rsh-tool-terminal', scope: 'root', config: { type: 'shell' } },
    ],
  })
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('pty-tools-sandbox-backend: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        // The recorded turn opened a PTY, read it, asked for a missing session, then
        // closed the one it opened.
        // Native renders these as "opened terminal <label>", "terminal: invalid session id"
        // and "closed terminal <label>"; the compatibility renderer writes "started
        // terminal session <label>" and "unknown PTY session <id>" instead. The tool
        // sequence and the session lifecycle agree either way.
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined))
          .toEqual(['terminal_open', 'terminal_read', 'terminal_signal', 'terminal_close', 'terminal_list'])
        const rendered = events.filter(event => event.type === 'tool/result').map((result) =>
          result.type === 'tool/result' ? String(result.data.message.content[0]?.content?.[0]?.text) : '').join(String.fromCharCode(10))
        expect(rendered).toContain('opened terminal pty-1')
        expect(rendered).toContain('invalid session id')
        expect(rendered).toContain('closed terminal pty-1')
        expect(rendered).toContain('(no terminal sessions)')
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])

      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
