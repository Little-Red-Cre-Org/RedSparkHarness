/**
 * Which controls a schedule card offers.
 *
 * These rules decide what a user can press, so each one is pinned here rather
 * than only through the panel: a rendering test proves a button appears for one
 * fixture, while these prove the rule holds for every combination.
 */
import { describe, expect, it } from 'vitest'
import { scheduleActions } from '../src/schedule-actions.ts'

describe('scheduleActions', () => {
  it('offers nothing at all once the owning Session is closed', () => {
    // Not "disabled": a greyed control still reads as "this could work", and it
    // cannot while the Session is shut, because the Host has no owner to act as.
    expect(scheduleActions({ controllable: false, state: 'active' })).toEqual([])
    expect(scheduleActions({ controllable: false, state: 'paused', kind: 'scheduled' })).toEqual([])
    expect(scheduleActions({ controllable: false, state: 'failed', kind: 'goal' })).toEqual([])
  })

  it('offers pause and delete for a live active plan', () => {
    expect(scheduleActions({ controllable: true, state: 'active' })).toEqual(['pause', 'delete'])
  })

  it('swaps pause for resume once the plan is paused', () => {
    expect(scheduleActions({ controllable: true, state: 'paused' })).toEqual(['resume', 'delete'])
  })

  it('still offers pause for a failed plan', () => {
    // "failed" is not "paused", so the toggle reads as pause: stopping further
    // attempts is meaningful and the store treats it as any admission change.
    expect(scheduleActions({ controllable: true, state: 'failed' })).toEqual(['pause', 'delete'])
  })

  it('never offers resume for a Goal plan, but keeps delete', () => {
    // Resuming a Goal needs an explicit direct human turn in that Session;
    // a list screen is by definition not one, so the button would only ever
    // produce a guaranteed refusal.
    expect(scheduleActions({ controllable: true, state: 'paused', kind: 'goal' })).toEqual(['delete'])
  })

  it('offers pause for a Goal plan that is still running', () => {
    // Pausing a Goal resolves the live continuation by id
    // (`pauseActiveGoal`), which needs no human turn — unlike resume.
    expect(scheduleActions({ controllable: true, state: 'active', kind: 'goal' })).toEqual(['pause', 'delete'])
  })

  it('treats an unknown producer like a scheduled plan', () => {
    // Rows written before the field existed carry no kind; they are ordinary
    // plans, so both verbs are legitimate.
    expect(scheduleActions({ controllable: true, state: 'paused', kind: undefined })).toEqual(['resume', 'delete'])
  })

  it('keeps a stable action order for a live scheduled plan', () => {
    // The toggle is always first and delete last, so the destructive verb never
    // sits where the toggle was.
    expect(scheduleActions({ controllable: true, state: 'active', kind: 'scheduled' })[0]).toBe('pause')
    expect(scheduleActions({ controllable: true, state: 'active', kind: 'scheduled' }).at(-1)).toBe('delete')
  })
})
