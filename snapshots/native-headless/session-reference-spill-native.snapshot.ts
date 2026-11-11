/** Recorded session-reference-spill scenario replayed through the shipped native profile. */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@redspark/rsh-llm-replay'
import { JsonlSessionBackend } from '@redspark/rsh-session-persistence-jsonl'
import { assembleNativeScenario, reexportPackage } from '@redspark/rsh-session-snapshot'
import { ensureShippedNativeProfile } from '../../rsh/Programs/CLI/src/native-profile-template.ts'
import { seedReferenceSource } from '../session/session-reference-spill/native-source-session.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const scene = join(root, 'snapshots/session/session-reference-spill')
const fixture = join(scene, 'session.v3.jsonl')
const quiet = new Set(['time-context', 'skills', 'skill-filesystem', 'tool-skill', 'skill-badge', 'archify'])

it('replays the recorded session-reference-spill session through a Native profile', async () => {
  const recorded = parseSessionLog(readFileSync(fixture, 'utf8'))
  const inbox = recorded.find(event => event.type === 'agent/inbox/spliced' && event.data.inserted.length > 0)
  const task = inbox?.type === 'agent/inbox/spliced' ? inbox.data.inserted[0]?.content[0] : undefined
  if (task?.type !== 'text') throw new Error('session-reference-spill: no recorded mention')

  const priorHome = process.env.RSH_HOME
  const profileHome = mkdtempSync(join(tmpdir(), 'spill-profile-'))
  process.env.RSH_HOME = profileHome
  try {
    ensureShippedNativeProfile('headless')
  } finally {
    if (priorHome === undefined) delete process.env.RSH_HOME
    else process.env.RSH_HOME = priorHome
  }

  const scenario = assembleNativeScenario({
    root,
    scene,
    profileRoot: join(profileHome, 'profiles', 'headless'),
    modules: [{ name: 'rsh-llm-replay', path: 'rsh/Tests/test-support/llm-replay' }],
    localPackages: [reexportPackage('rsh-llm-replay-native', '@redspark/rsh-llm-replay/native')],
    composeRow: (row, paths) => {
      if (quiet.has(row.id)) return { ...row, disabled: true }
      if (row.id === 'app') {
        return { ...row, config: { ...row.config, cwd: paths.workspace, provider: 'deepseek-official',
          model: 'deepseek-v4-flash', systemPrompt: 'Use the referenced session as background.', maxSteps: 3 } }
      }
      if (row.id === 'session-reference') return { ...row, config: { maxReferenceBytes: 360 } }
      if (row.id === 'spill-store') return { ...row, config: { root: join(paths.home, 'spill'), cleanupPeriodDays: 0 } }
      if (row.id === 'pi-ai') {
        return { ...row, plugin: 'rsh-llm-replay-native', config: { file: fixture, script: deriveReplayScript(recorded) } }
      }
      return row
    },
  })
  await seedReferenceSource(new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' }) as never)
  try {
    await scenario.run(task.text)
    const storage = new JsonlSessionBackend({ root: scenario.paths.sessions, compression: 'none' })
    try {
      const own = (await storage.list()).map(record => String(record.header.id)).filter(id => id !== 'reference-source')
      const id = own[0]
      if (id === undefined) throw new Error('session-reference-spill: no persisted Session')
      const reader = await storage.open(id as never, 'read')
      try {
        const events = (await reader.read()).events
        const messages = events.filter(event => event.type === 'user/message')
        expect(messages.map(event => event.data.source?.kind)).toEqual(['user', 'session-reference', 'plugin'])
        const user = messages[0]
        const text = user?.type === 'user/message' && user.data.content[0]?.type === 'text' ? user.data.content[0].text : ''
        expect(text).toBe('Use @Research as background, then reply DONE.')
        expect(JSON.stringify(messages[1])).toContain('LATEST_SOURCE_FACT')
      } finally { await reader.close() }
    } finally { await storage.close() }
  } finally { scenario.dispose() }
})
