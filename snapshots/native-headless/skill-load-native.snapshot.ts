/** Recorded skill-load scenario replayed through a Native profile. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/skill-load')
const fixture = join(scene, 'session.v3.jsonl')
const SKILL_NAME = 'editing-cordis-compositions'
const INSTRUCTIONS_START = '<skill_instructions>'
const INSTRUCTIONS_END = '</skill_instructions>'

function recordedInstructions(text: string): string {
  const start = text.indexOf(INSTRUCTIONS_START)
  const end = text.indexOf(INSTRUCTIONS_END)
  if (start < 0 || end < start) throw new Error('skill-load: recorded instructions missing')
  return text.slice(start + INSTRUCTIONS_START.length, end).trim()
}

it('replays the recorded skill-load session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const input = recorded.find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (input?.type !== 'user/message' || input.data.content[0]?.type !== 'text') throw new Error('skill-load: no recorded task')
  const recordedResult = recorded.find(event => event.type === 'tool/result')
  const recordedText = recordedResult?.type === 'tool/result'
    ? recordedResult.data.message.content[0]?.content[0]?.text ?? ''
    : ''
  const instructions = recordedInstructions(recordedText)

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
      { name: 'rsh-request-context', path: 'rsh/Engine/context/request-context' },
      { name: 'rsh-skill', path: 'rsh/Modules/Official/skill/skill' },
      { name: 'rsh-skill-filesystem', path: 'rsh/Modules/Official/skill/skill-filesystem' },
      { name: 'rsh-tool-skill', path: 'rsh/Modules/Official/skill/tool-skill' },
      { name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' },
    ],
    localPackages: [reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native')],
    composeRow: (row, paths) => {
      if (row.id === 'app') {
        return { ...row, config: { cwd: paths.workspace, provider: 'deepseek-official', model: 'deepseek-v4-flash',
          systemPrompt: 'Answer the request.', maxSteps: 3 } }
      }
      if (['code-runtime', 'time-context', 'jobs', 'tool-jobs'].includes(row.id)) return { ...row, disabled: true }
      return row
    },
    model: { plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } },
    extraRows: (paths) => [
      { id: 'session-execution', plugin: '@redspark/rsh-native-session-execution', scope: 'root' },
      { id: 'permission-presets', plugin: '@redspark/rsh-permission-presets', scope: 'root' },
      { id: 'sandbox-policy', plugin: '@redspark/rsh-native-sandbox-policy', scope: 'root',
        config: { mode: 'danger-full-access', workspaceRoot: paths.workspace } },
      { id: 'approval', plugin: '@redspark/rsh-native-approval', scope: 'root', config: { policy: 'never' } },
      { id: 'session-title', plugin: '@redspark/rsh-session-title', scope: 'root',
        config: { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } },
      { id: 'request-context', plugin: '@redspark/rsh-request-context', scope: 'root' },
      { id: 'skills', plugin: '@redspark/rsh-skill', scope: 'root' },
      { id: 'skill-filesystem', plugin: '@redspark/rsh-skill-filesystem', scope: 'root',
        config: {
          includeDefaultRoots: false,
          watch: false,
          rshHome: paths.home,
          agentsHome: paths.home,
          customSkillDirs: [join(paths.workspace, '.planted-skills')],
        } },
      { id: 'tool-skill', plugin: '@redspark/rsh-tool-skill', scope: 'root' },
    ],
  })
  try {
    // The preset file the Cordis setup copied is gone. The recording still holds the
    // instruction body, so the Native replay plants that body instead of re-recording.
    const skillDir = join(scenario.paths.workspace, '.planted-skills', SKILL_NAME)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      `name: ${SKILL_NAME}`,
      'description: Use when creating, changing, or validating a Cordis composition for this harness.',
      '---',
      '',
      instructions,
      '',
    ].join('\n'))
    await scenario.run(input.data.content[0].text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const id = (await storage.list())[0]?.header.id
      if (id === undefined) throw new Error('skill-load: no persisted Session')
      const reader = await storage.open(id, 'read')
      try {
        const events = (await reader.read()).events
        const results = events.filter(event => event.type === 'tool/result')
        expect(results).toHaveLength(1)
        const rendered = results[0]?.type === 'tool/result'
          ? results[0].data.message.content[0]?.content[0]?.text ?? '' : ''
        expect(rendered).toContain(`skill_content name="${SKILL_NAME}"`)
        expect(rendered).toContain('# Editing Cordis compositions')
        expect(events.filter(event => event.type === 'tool/call').map(event => event.type === 'tool/call' ? event.data.name : undefined))
          .toEqual(['skill'])
        const done = events.filter(event => event.type === 'assistant/message').some(event => {
          if (event.type !== 'assistant/message') return false
          return event.data.message.content.some(part => part.type === 'text' && part.text === 'DONE')
        })
        expect(done).toBe(true)
        expect(events.filter(event => event.type === 'turn/end'))
          .toMatchObject([{ data: { reason: { kind: 'completed' } } }])
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
