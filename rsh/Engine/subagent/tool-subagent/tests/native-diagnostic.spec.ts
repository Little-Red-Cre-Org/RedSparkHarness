import { expect, it } from 'vitest'
import type { NativeContext } from '@redspark/rsh-native-runtime'
import type { NativeValueToolContribution } from '@redspark/rsh-native-tools'
import { plugin } from '../src/native.ts'

function contribution(): NativeValueToolContribution {
  const install = plugin.resolve({ toolName: 'subagent', maxDepth: 1 })
  let registered: NativeValueToolContribution | undefined
  const context = {
    require: (name: string) => {
      if (name === 'subagents') return { providerName: 'codex' }
      if (name === 'tools') return { registerValueTool: (value: NativeValueToolContribution) => {
        registered = value
        return () => {}
      } }
      throw new Error(name)
    },
    optional: () => undefined,
    own: () => {},
  } as unknown as NativeContext
  void install(context)
  if (registered === undefined) throw new Error('tool was not registered')
  return registered
}

it('renders an external diagnostic between the headline and preserved partial output', () => {
  const rendered = contribution().output.render({} as never, {
    id: 'child', provider: 'codex', remoteId: 'remote', stopReason: 'error',
    output: [{ type: 'text', text: 'partial' }],
    diagnostic: 'permission denied',
  })
  expect(rendered.content).toEqual([{ type: 'text', text: 'subagent run failed\nDiagnostic: permission denied\nPartial output before the run ended:\npartial' }])
  expect(rendered.isError).toBe(true)
})

it('renders a diagnostic without inventing partial output', () => {
  const rendered = contribution().output.render({} as never, {
    id: 'child', provider: 'codex', remoteId: 'remote', stopReason: 'aborted',
    output: [],
    diagnostic: 'cancelled an unattended dialog',
  })
  expect(rendered.content).toEqual([{ type: 'text', text: 'subagent run was cancelled\nDiagnostic: cancelled an unattended dialog' }])
})

it('keeps a local failure headline when the result has no product diagnostic', () => {
  const rendered = contribution().output.render({} as never, {
    id: 'child', provider: 'spawn', stopReason: 'max-tokens',
    output: [{ type: 'text', text: 'partial' }],
  })
  expect(rendered.content).toEqual([{ type: 'text', text: 'subagent run hit its token limit before finishing\nPartial output before the run ended:\npartial' }])
})

it('omits the diagnostic label when a remote result has no diagnostic', () => {
  const rendered = contribution().output.render({} as never, {
    id: 'child', provider: 'codex', remoteId: 'remote', stopReason: 'error',
    output: [{ type: 'text', text: 'partial' }],
  })
  expect(rendered.content).toEqual([{ type: 'text', text: 'subagent run failed\nPartial output before the run ended:\npartial' }])
})

it('declares background execution for an external provider that shares the Jobs registry', () => {
  const jobs = {}
  const install = plugin.resolve({ toolName: 'subagent_codex', provider: 'codex', maxDepth: 1, backgroundMode: 'one-shot' })
  let registered: NativeValueToolContribution | undefined
  const context = {
    require: (name: string) => {
      if (name === 'subagents') return { providerName: 'codex', backgroundJobs: jobs }
      if (name === 'tools') return { registerValueTool: (value: NativeValueToolContribution) => {
        registered = value
        return () => {}
      } }
      throw new Error(name)
    },
    optional: (name: string) => name === 'jobs' || name === 'jobControls' ? name === 'jobControls' ? { jobs } : jobs : undefined,
    own: () => {},
  } as unknown as NativeContext
  void install(context)
  if (registered === undefined) throw new Error('tool was not registered')
  expect(registered.schema.parameters).toMatchObject({ properties: { run_in_background: { type: 'boolean' } } })
  const rendered = registered.output.render({} as never, {
    id: 'op', provider: 'codex', remoteId: 'remote-1', jobId: 'subagent-1',
  })
  expect(rendered.content).toEqual([{ type: 'text', text: 'Background subagent started. Job: subagent-1. Remote id: remote-1. Use job_output to read output or wait; job_kill requests cancellation.' }])
  expect(rendered.meta).toMatchObject({ externalChildId: 'op', remoteId: 'remote-1', jobId: 'subagent-1' })
  expect(JSON.stringify(rendered)).not.toContain('Child session')
})

it('omits the diagnostic label when the product detail is empty', () => {
  const rendered = contribution().output.render({} as never, {
    id: 'child', provider: 'codex', remoteId: 'remote', stopReason: 'error',
    output: [],
    diagnostic: '',
  })
  expect(rendered.content).toEqual([{ type: 'text', text: 'subagent run failed' }])
})
