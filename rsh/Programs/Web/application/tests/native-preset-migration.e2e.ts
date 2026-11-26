/** Cold V2 restoration through the shipped Native Web Host mounts the PTC preset and publishes only a V3 successor. */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { SessionId } from '@redspark/rsh-session'
import { generationLogPath } from '../../../../Engine/session/session-persistence-jsonl/src/format.ts'
import type {} from '@redspark/rsh-agent-presets'
import { launchNativeWeb, type NativeWebScaffold } from './native-scaffold.ts'

const FIXTURE = fileURLToPath(new URL('../../../../../snapshots/web/preset-migration/session.v2.jsonl', import.meta.url))
const SESSION_ID = SessionId('preset-migration')

/** The Session header one Host history read exposes. */
interface History {
  readonly header: { readonly agentPreset?: string }
}

/**
 * Lay the released fixture out as one committed V2 generation: dense `seq` and
 * `time` on every row, optionally without the recorded preset selections so the
 * variant resumes from the header alone.
 */
function committedV2(withSelections: boolean): (text: string) => string {
  return (text) => {
    const [header, ...events] = text.trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    return [header, ...events
      .filter(event => withSelections || event.type !== 'agent-preset/selected')
      .map((event, seq) => ({ ...event, seq, time: seq + 2 }))]
      .map(row => JSON.stringify(row)).join('\n') + '\n'
  }
}

/** Paths of a Session's committed generations inside the fixture root. */
function generationPaths(scaffold: NativeWebScaffold): { readonly predecessor: string; readonly successor: string } {
  const predecessor = generationLogPath(scaffold.sessionRoot, scaffold.workspaceCwd, SESSION_ID, 2, 'none')
  return { predecessor, successor: join(dirname(predecessor), 'session.v3.jsonl') }
}

/** Cold-open the Session the way the client does when it is selected, which mounts its recorded preset. */
async function coldOpen(scaffold: NativeWebScaffold): Promise<void> {
  const controls = await scaffold.rpc('session/mode-controls', { sessionId: SESSION_ID })
  if (!controls.ok) throw new Error('session/mode-controls failed: ' + controls.error.message)
}

it.each([false, true])('resumes code as PTC (selection events=%s)', async (withSelections) => {
  const scaffold = await launchNativeWeb({
    drop: ['pi-ai'],
    predecessor: { fixture: FIXTURE, seedId: SESSION_ID, transform: committedV2(withSelections) },
  })
  try {
    const { predecessor, successor } = generationPaths(scaffold)
    const source = await readFile(predecessor)
    await coldOpen(scaffold)
    await expect.poll(() => readFile(successor).then(() => true, () => false), { timeout: 15_000 }).toBe(true)

    const history = await scaffold.rpc<History>('session/history', { sessionId: SESSION_ID })
    if (!history.ok) throw new Error('session/history failed: ' + history.error.message)
    expect(history.value.header.agentPreset).toBe('ptc')

    // Preset selections are not surface events, so the successor log is the only reader that sees them.
    const published = (await readFile(successor, 'utf8')).split('\n').filter(line => line.trim() !== '')
      .map(line => JSON.parse(line) as { readonly type: string; readonly data?: unknown; readonly seq: number; readonly time: number })
    const selections = withSelections ? ['ptc', 'standard', 'ptc'] : []
    const restored = [
      ...selections.map(agentPreset => ({ type: 'agent-preset/selected', data: { agentPreset } })),
      { type: 'session/end-seed', data: {} },
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'feedback/record', data: { text: 'Keep code as literal feedback.' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(published[0]).toMatchObject({ version: 3, agentPreset: 'ptc' })
    expect(published.slice(1, 1 + restored.length)).toEqual(restored.map((event, index) => ({
      ...event, seq: index, time: index + 2,
    })))
    // Agent activation closes the restored prefix with a fresh seed marker, then
    // the cold open appends the Session's mode controls.
    expect(published.slice(1 + restored.length).map(event => [event.type, event.data])).toEqual([
      ['session/end-seed', {}],
      ['permission/preset', { preset: 'workspace-write' }],
      ['sandbox/mode', { mode: 'workspace-write' }],
      ['approval/policy', { policy: 'ask' }],
    ])
    expect(await readFile(predecessor)).toEqual(source)
    expect((await readdir(dirname(predecessor))).filter(name => name.endsWith('.jsonl')).sort())
      .toEqual(['session.v2.jsonl', 'session.v3.jsonl'])
  } finally {
    await scaffold.close()
  }
}, 120_000)
