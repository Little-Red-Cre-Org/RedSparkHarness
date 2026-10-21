/** Required Session execution-policy vocabulary and folding. */
import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/native'
import { nativeSessionExecutionPolicy, readNativeSessionExecutionPolicy } from '../src/index.ts'

const policy = {
  version: 1,
  maxSteps: 12,
  maxTokens: 4000,
  permission: { mode: 'require-approval', authority: 'session-owner' },
} as const

function policyEvent(ignorable?: true): SessionEvent<'execution/policy'> {
  return {
    type: 'execution/policy',
    seq: SessionSeq(0),
    time: 0,
    data: policy,
    ...(ignorable === undefined ? {} : { ignorable }),
  }
}

it('folds one required policy and rejects duplicate, ignorable, or malformed authority records', () => {
  expect(nativeSessionExecutionPolicy([])).toBeUndefined()
  expect(nativeSessionExecutionPolicy([policyEvent()])).toEqual(policy)
  expect(nativeSessionExecutionPolicy([
    { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } }, policyEvent(),
  ])).toEqual(policy)
  expect(readNativeSessionExecutionPolicy(policy)).toEqual(policy)
  expect(readNativeSessionExecutionPolicy({ version: 1, maxSteps: 12, permission: { mode: 'deny' } }))
    .toEqual({ version: 1, maxSteps: 12, permission: { mode: 'deny' } })
  expect(() => nativeSessionExecutionPolicy([policyEvent(), { ...policyEvent(), seq: SessionSeq(1) }]))
    .toThrow('Session has multiple execution policies')
  expect(() => nativeSessionExecutionPolicy([policyEvent(true)])).toThrow('must be required-on-read')
  for (const malformed of [null, [], 'policy']) {
    expect(() => readNativeSessionExecutionPolicy(malformed)).toThrow('execution policy must be an object')
  }
  for (const permission of [null, [], 'deny']) {
    expect(() => readNativeSessionExecutionPolicy({ ...policy, permission })).toThrow('permission must be an object')
  }
  expect(() => readNativeSessionExecutionPolicy({ ...policy, maxSteps: 0 })).toThrow('maxSteps must be a positive safe integer')
  expect(() => readNativeSessionExecutionPolicy({ ...policy, version: 2 })).toThrow('version is unsupported')
  expect(() => readNativeSessionExecutionPolicy({ ...policy, maxTokens: 0 })).toThrow('maxTokens must be a positive safe integer')
  expect(() => readNativeSessionExecutionPolicy({ ...policy, unknown: true })).toThrow('unsupported fields')
  expect(() => readNativeSessionExecutionPolicy({ ...policy, permission: { mode: 'deny', authority: 'session-owner' } }))
    .toThrow('permission is unsupported')
})
