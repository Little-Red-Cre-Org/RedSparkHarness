/** Native job-list fold: every frame kind must land in the right Session bucket. */
import { describe, expect, it } from 'vitest'
import { applyJobsFrame } from '../src/native-ui.tsx'
import type { NativeSessionJob, NativeSessionJobsFrame } from '@deepseek-ai/dsh-client-native-session/jobs-types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Build one row with only the fields the fold reads. */
function job(id: string, sessionId: string, over: Partial<NativeSessionJob> = {}): NativeSessionJob {
  return {
    id,
    sessionId: sessionId as SessionId,
    kind: 'bash',
    label: id,
    status: 'running',
    startedAt: 1_000,
    ...over,
  }
}

describe('applyJobsFrame', () => {
  it('groups a baseline by owning Session', () => {
    const next = applyJobsFrame({}, {
      type: 'baseline',
      jobs: [job('a1', 's1'), job('a2', 's1'), job('b1', 's2')],
    })
    expect(Object.keys(next).sort()).toEqual(['s1', 's2'])
    expect(next.s1?.map(row => row.id)).toEqual(['a1', 'a2'])
    expect(next.s2?.map(row => row.id)).toEqual(['b1'])
  })

  it('replaces an upserted row in place instead of appending a duplicate', () => {
    const start = applyJobsFrame({}, { type: 'baseline', jobs: [job('a1', 's1')] })
    const next = applyJobsFrame(start, {
      type: 'upsert',
      job: job('a1', 's1', { status: 'completed', label: 'renamed', finishedAt: 2_000 }),
    })
    expect(next.s1).toHaveLength(1)
    expect(next.s1?.[0]?.label).toBe('renamed')
    expect(next.s1?.[0]?.status).toBe('completed')
  })

  it('appends an upsert for a job it has not seen', () => {
    const start = applyJobsFrame({}, { type: 'baseline', jobs: [job('a1', 's1')] })
    const next = applyJobsFrame(start, { type: 'upsert', job: job('a2', 's1') })
    expect(next.s1?.map(row => row.id)).toEqual(['a1', 'a2'])
  })

  it('removes a row from whichever Session holds it and drops the empty bucket', () => {
    const start = applyJobsFrame({}, {
      type: 'baseline',
      jobs: [job('a1', 's1'), job('b1', 's2')],
    })
    const afterS1 = applyJobsFrame(start, { type: 'remove', id: 'a1' })
    expect(afterS1.s1).toBeUndefined()
    expect(afterS1.s2?.map(row => row.id)).toEqual(['b1'])
    const afterS2 = applyJobsFrame(afterS1, { type: 'remove', id: 'b1' })
    expect(afterS2).toEqual({})
  })

  it('leaves the grouping untouched when the removed id belongs to nobody', () => {
    const start = applyJobsFrame({}, { type: 'baseline', jobs: [job('a1', 's1')] })
    const next = applyJobsFrame(start, { type: 'remove', id: 'ghost' })
    expect(next.s1?.map(row => row.id)).toEqual(['a1'])
  })

  it('drops the whole bucket when the Session is gone', () => {
    const start = applyJobsFrame({}, {
      type: 'baseline',
      jobs: [job('a1', 's1'), job('b1', 's2')],
    })
    const next = applyJobsFrame(start, { type: 'session-gone', sessionId: 's1' as SessionId })
    expect(next.s1).toBeUndefined()
    expect(next.s2?.map(row => row.id)).toEqual(['b1'])
  })

  it('never mutates the grouping it was given', () => {
    const start = applyJobsFrame({}, { type: 'baseline', jobs: [job('a1', 's1')] })
    const before = JSON.stringify(start)
    const frames: NativeSessionJobsFrame[] = [
      { type: 'upsert', job: job('a2', 's1') },
      { type: 'remove', id: 'a1' },
      { type: 'session-gone', sessionId: 's1' as SessionId },
    ]
    for (const frame of frames) applyJobsFrame(start, frame)
    expect(JSON.stringify(start)).toBe(before)
  })
})
