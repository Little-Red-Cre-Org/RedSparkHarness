/** Explicit policy selection and Session workspace resolution. */
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { NativeSandboxPolicy, resolveConfig } from '../src/index.ts'

it('rejects missing, relative and unsupported policy choices', () => {
  expect(() => resolveConfig(undefined)).toThrow('must be an object')
  expect(() => resolveConfig({ mode: 'unknown', workspaceRoot: resolve('fallback') })).toThrow('mode must be')
  expect(() => resolveConfig({ mode: 'read-only', workspaceRoot: 'relative' })).toThrow('must be an absolute path')
  expect(() => resolveConfig({ mode: 'read-only', workspaceRoot: resolve('fallback'), unknown: true })).toThrow('unsupported configuration field')
})

it('uses the Session workspace and explicit deployment fallback', () => {
  const fallback = resolve('fallback')
  const workspace = resolve('workspace')
  const policy = new NativeSandboxPolicy(resolveConfig({ mode: 'workspace-write', workspaceRoot: fallback }))
  const id = SessionId('policy-session')
  const session = Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: workspace, isSeeded: false, delegationDepth: 0,
  })
  expect(policy.defaultMode).toBe('workspace-write')
  expect(policy.resolve()).toMatchObject({ mode: 'workspace-write', workspaceRoot: fallback })
  expect(policy.resolve({ session })).toMatchObject({ mode: 'workspace-write', workspaceRoot: workspace })
})
