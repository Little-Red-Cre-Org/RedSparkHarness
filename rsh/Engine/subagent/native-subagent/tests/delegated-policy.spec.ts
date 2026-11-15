import { expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@redspark/rsh-session/native'
import { appendDelegatedPolicy, captureDelegatedPolicy } from '../src/delegated-policy.ts'

function parent(mode?: 'read-only' | 'workspace-write' | 'danger-full-access'): Session {
  const id = SessionId('delegated-policy-parent')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/work', isSeeded: false, delegationDepth: 0,
  })
  if (mode !== undefined) session.append('sandbox/mode', { mode })
  return session
}

it('seeds an explicit sandbox override and pins approval without copying the deployment default', () => {
  const events: unknown[] = []
  appendDelegatedPolicy((type, data) => { events.push({ type, data }) }, captureDelegatedPolicy(parent('read-only'), true))
  expect(events).toEqual([
    { type: 'sandbox/mode', data: { mode: 'read-only', source: 'delegation' } },
    { type: 'approval/policy', data: { policy: 'never', source: 'delegation' } },
  ])
  events.length = 0
  appendDelegatedPolicy((type, data) => { events.push({ type, data }) }, captureDelegatedPolicy(parent(), true))
  expect(events).toEqual([{ type: 'approval/policy', data: { policy: 'never', source: 'delegation' } }])
  events.length = 0
  appendDelegatedPolicy((type, data) => { events.push({ type, data }) }, captureDelegatedPolicy(parent('workspace-write'), false))
  expect(events).toEqual([{ type: 'sandbox/mode', data: { mode: 'workspace-write', source: 'delegation' } }])
})

it('uses the latest parent sandbox mode', () => {
  const session = parent('workspace-write')
  session.append('sandbox/mode', { mode: 'danger-full-access' })
  expect(captureDelegatedPolicy(session, false)).toEqual({ sandboxMode: 'danger-full-access' })
})
