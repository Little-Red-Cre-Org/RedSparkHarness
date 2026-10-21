/** Native `/compact` installation and shared result presentation. */
import { describe, expect, it } from 'vitest'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { ManualCompactionError, CompactionId } from '@deepseek-ai/dsh-compaction/native'
import { SessionSeq } from '@deepseek-ai/dsh-session/native'
import { executeCompact } from '../src/common.ts'
import { plugin } from '../src/native.ts'

const invocation = (rawInput = '') => ({ commandId: CommandId('command-1'), rawInput, signal: new AbortController().signal })

describe('native /compact', () => {
  it('requires the command service and the selected compaction Provider', () => {
    expect(plugin).toMatchObject({ targets: ['host'], requires: ['commands', 'compaction'], provides: [] })
    expect(() => plugin.resolve({ verbose: true })).toThrow(/empty object/)
  })

  it('forwards the command identity and reports the committed span', async () => {
    const result = await executeCompact(invocation(), async (_signal, sourceCommandId) => {
      expect(sourceCommandId).toBe('command-1')
      return { compactionId: CompactionId('compaction-1'), sourceCommandId, startSeq: SessionSeq(4), summarySeq: SessionSeq(5),
        endSeq: SessionSeq(7), summary: [], shadowedRange: { start: SessionSeq(1), end: SessionSeq(3) },
        shadowedSeqs: [SessionSeq(1), SessionSeq(2), SessionSeq(3)], shadowedTokenCount: 420 }
    })
    expect(result).toEqual({ kind: 'success', text: 'Compacted 3 history items (~420 tokens).', sourceEventSeq: 5 })
  })

  it('maps expected backend failures to human outcomes', async () => {
    expect(await executeCompact(invocation('now'), () => { throw new Error('unreachable') }))
      .toEqual({ kind: 'error', text: 'Usage: /compact (no arguments)' })
    expect(await executeCompact(invocation(), () => Promise.resolve(null)))
      .toEqual({ kind: 'success', text: 'No compactable history yet.' })
    const busy = await executeCompact(invocation(), () => Promise.reject(new ManualCompactionError('busy', 'open turn')))
    expect(busy).toMatchObject({ kind: 'error', text: expect.stringContaining('not idle') as string })
    await expect(executeCompact(invocation(), () => Promise.reject(new Error('backend defect')))).rejects.toThrow('backend defect')
  })
})
