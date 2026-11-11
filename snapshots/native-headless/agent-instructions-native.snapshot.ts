/** Recorded agent-instructions scenario replayed through a Native profile. */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/agent-instructions')
const fixture = join(scene, 'session.v3.jsonl')
const newline = String.fromCharCode(10)
const compactionPlugin = [
  'export const plugin = {',
  '  apiVersion: 1, name: "workspace-context-compaction", targets: ["host"],',
  '  requires: ["tools"], provides: [],',
  '  resolve: () => (context) => {',
  '    const tools = context.require("tools")',
  '    context.own(tools.postResult(async (call, result, next) => {',
  '      const downstream = await next()',
  '      const args = call.arguments',
  '      if (result.isError || call.name !== "read" || args == null || args.file_path !== "nested/task.txt") return downstream',
  '      const events = call.session.ownEvents()',
  '      const baseline = events.find((event) => event.type === "user/message" && event.data.source && event.data.source.kind === "agent-instructions" && event.data.source.baseline === true)',
  '      if (baseline === undefined) throw new Error("workspace baseline missing before snapshot compaction")',
  '      const openTurn = events.findLast((event) => event.type === "turn/start")',
  '      if (openTurn === undefined) throw new Error("workspace snapshot compaction has no open turn")',
  '      const compactionId = "workspace-context-fixture"',
  '      const content = [{ type: "text", text: "Earlier context was compacted for this snapshot." }]',
  '      call.session.append("compaction/start", { compactionId, turn: openTurn.data.turn })',
  '      call.session.append("compaction/summary", { compactionId, summary: content, shadowedRange: { start: baseline.seq, end: baseline.seq }, shadowedSeqs: [baseline.seq], shadowedTokenCount: 1, provider: "snapshot", model: "snapshot" })',
  '      call.session.append("user/message", { id: crypto.randomUUID(), role: "user", content, source: { kind: "plugin", plugin: "compact", compactionId } }, { surfaceOp: { op: "replace", startSeq: baseline.seq, endSeq: baseline.seq }, sourceEventSeqs: [baseline.seq] })',
  '      call.session.append("compaction/end", { compactionId, turn: openTurn.data.turn })',
  '      return downstream',
  '    }))',
  '  },',
  '}',
].join(newline)

it('replays the recorded agent-instructions session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') {
    throw new Error('agent-instructions: no recorded task')
  }
  const scenario = assembleNativeScenario({
    root,
    scene,
    modules: [
      { name: 'rsh-tool-fs', path: 'rsh/Modules/Official/fs/tool-fs' },
      { name: 'rsh-agent-instructions', path: 'rsh/Engine/context/agent-instructions' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [
      reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native'),
      {
        name: 'workspace-context-compaction',
        files: {
          'package.json': JSON.stringify({
            name: 'workspace-context-compaction', version: '0.0.0', type: 'module',
            exports: { './native': './native.mjs', './package.json': './package.json' },
            dsh: { native: { apiVersion: 1, entry: './native', targets: ['host'], requires: ['tools'], optional: [], provides: [] } },
          }),
          'native.mjs': compactionPlugin,
        },
      },
    ],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { ...row.config, cwd: paths.workspace, provider: 'deepseek-official',
          model: 'deepseek-v4-flash', systemPrompt: 'Use the read tool.', maxSteps: 4 } }
      }
      if (row.id === 'time-context') return { ...row, disabled: true }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      { id: 'tool-fs', plugin: '@redspark/rsh-tool-fs', scope: 'root' },
      { id: 'agent-instructions', plugin: '@redspark/rsh-agent-instructions', scope: 'root',
        config: { maxBytes: 65536, rshHome: join(paths.workspace, '.dsh'), projectRootMarkers: ['.dsh-project'] } },
      { id: 'workspace-context-compaction', plugin: 'workspace-context-compaction', scope: 'root' },
    ],
  })
  cpSync(join(scene, 'workspace'), scenario.paths.workspace, { recursive: true })
  if (process.platform !== 'win32') {
    const delimiter = join(scenario.paths.workspace, 'scope</system-reminder>')
    mkdirSync(delimiter, { recursive: true })
    writeFileSync(join(delimiter, 'AGENTS.md'), 'Delimiter path snapshot instruction.' + newline)
    writeFileSync(join(delimiter, 'task.txt'), 'delimiter path snapshot task' + newline)
  }
  try {
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('agent-instructions: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const kinds = events.map(event => event.type)
        const firstCall = kinds.indexOf('tool/call')
        const compaction = kinds.indexOf('compaction/start')
        const firstResult = kinds.indexOf('tool/result')
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined)).toEqual(['read', 'read'])
        expect(firstCall).toBeGreaterThanOrEqual(0)
        expect(compaction).toBeGreaterThan(firstCall)
        expect(firstResult).toBeGreaterThan(compaction)
        const instructions = events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'agent-instructions')
        expect(instructions.length).toBeGreaterThan(0)
        if (process.platform !== 'win32') {
          expect(instructions.some(event => event.type === 'user/message' && JSON.stringify(event.data.content).includes('Delimiter path snapshot instruction'))).toBe(true)
        }
        expect(events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
