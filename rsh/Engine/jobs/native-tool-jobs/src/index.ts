/** Model-facing controls for native Agent-owned background jobs. */
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import { NativeJobId, type NativeJobRegistry, type NativeJobSnapshot } from '@deepseek-ai/dsh-native-jobs'
import type { NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import { TextRetainer } from '@deepseek-ai/dsh-output-retention'

/** Registry bound to the installed job_output, job_list and job_kill tools. */
export interface NativeJobControls {
  readonly jobs: NativeJobRegistry
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { jobControls: NativeJobControls }
}

interface Config {
  readonly waitTimeoutMs: number
  readonly maxWaitTimeoutMs: number
  readonly maxOutputBytes: number
}

function positiveDelay(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error(`native-tool-jobs: ${field} must be a positive finite timer delay`)
  }
  return value
}

function resolveConfig(input: unknown): Config {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    throw new Error('native-tool-jobs: configuration must be an object')
  }
  const fields = input as Record<string, unknown> | undefined
  for (const key of Object.keys(fields ?? {})) {
    if (key !== 'waitTimeoutMs' && key !== 'maxWaitTimeoutMs' && key !== 'maxOutputBytes') {
      throw new Error(`native-tool-jobs: unknown configuration field ${key}`)
    }
  }
  const maxWaitTimeoutMs = positiveDelay(fields?.maxWaitTimeoutMs ?? 600_000, 'maxWaitTimeoutMs')
  const waitTimeoutMs = positiveDelay(fields?.waitTimeoutMs ?? 30_000, 'waitTimeoutMs')
  if (waitTimeoutMs > maxWaitTimeoutMs) throw new Error('native-tool-jobs: waitTimeoutMs exceeds maxWaitTimeoutMs')
  const maxOutputBytes = fields?.maxOutputBytes ?? 16_384
  if (typeof maxOutputBytes !== 'number' || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 128) {
    throw new Error('native-tool-jobs: maxOutputBytes must be a safe integer of at least 128')
  }
  return { waitTimeoutMs, maxWaitTimeoutMs, maxOutputBytes }
}

function argumentsObject(input: unknown, permitted: readonly string[]): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('native-tool-jobs: tool arguments must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!permitted.includes(key)) throw new Error(`native-tool-jobs: unexpected argument ${key}`)
  }
  return fields
}

function jobId(value: unknown): NativeJobId {
  if (typeof value !== 'string') throw new Error('native-tool-jobs: job_id must be a string')
  return NativeJobId(value)
}

function status(job: NativeJobSnapshot): string {
  return `[status: ${job.status}]`
}

function bounded(text: string, maxBytes: number, suffix = '', kind: 'head' | 'tail' = 'head'): string {
  if (Buffer.byteLength(`${text}${suffix}`, 'utf8') <= maxBytes) return `${text}${suffix}`
  const marker = '\n[output truncated]'
  const fixedBytes = Buffer.byteLength(`${marker}${suffix}`, 'utf8')
  const retainer = new TextRetainer({ kind, maxBytes: Math.max(0, maxBytes - fixedBytes) })
  retainer.push(text)
  const result = retainer.finish()
  return result.truncated ? `${result.text}${marker}${suffix}` : `${result.text}${suffix}`
}

function jobValue(job: NativeJobSnapshot) {
  return { id: job.id, kind: job.kind, label: job.label, status: job.status, startedAt: job.startedAt,
    ...job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt },
    ...job.detail === undefined ? {} : { detail: job.detail },
  }
}

const output: NativeValueToolContribution['output'] = {
  schema: {
    type: 'object', properties: {
      text: { type: 'string' },
      truncated: { type: 'boolean' },
      jobs: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string' }, kind: { type: 'string' }, label: { type: 'string' },
        status: { type: 'string', enum: ['running', 'stopping', 'completed', 'failed', 'cancelled'] },
        startedAt: { type: 'number' }, finishedAt: { type: 'number' }, detail: { type: 'string' },
      }, required: ['id', 'kind', 'label', 'status', 'startedAt'], additionalProperties: false } },
      outcome: { type: 'string', enum: ['requested', 'already-finished'] },
    }, required: ['text', 'jobs'], additionalProperties: false,
  },
  render(_call, value) {
    // The registry validates this schema before rendering its text field.
    const result = value as { text: string; truncated?: boolean }
    return { content: [{ type: 'text', text: result.text }], isError: false,
      ...result.truncated === undefined ? {} : { meta: { truncated: result.truncated } } }
  },
}

/**
 * Build controls over a selected native registry. The application records their
 * results once in its authoritative Session; this package owns no job runners.
 * @param jobs - selected Agent-owned job registry.
 * @param config - validated wait defaults and cap.
 * @returns three tool contributions for registration in one native scope.
 */
export function nativeJobTools(jobs: NativeJobRegistry, config: Config): readonly NativeValueToolContribution[] {
  return [{
    output,
    schema: {
      name: 'job_output',
      description: 'Read retained live or final background job output and status; optionally wait for completion.',
      parameters: { type: 'object', properties: {
        job_id: { type: 'string' }, wait: { type: 'boolean' }, timeout_ms: { type: 'number' },
      }, required: ['job_id'], additionalProperties: false },
    },
    async execute(call) {
      const args = argumentsObject(call.arguments, ['job_id', 'wait', 'timeout_ms'])
      const id = jobId(args.job_id)
      if (args.wait !== undefined && typeof args.wait !== 'boolean') throw new Error('native-tool-jobs: wait must be a boolean')
      if (args.timeout_ms !== undefined && args.wait !== true) {
        throw new Error('native-tool-jobs: timeout_ms requires wait: true')
      }
      if (args.wait === true) {
        const requested = args.timeout_ms === undefined ? config.waitTimeoutMs : positiveDelay(args.timeout_ms, 'timeout_ms')
        await jobs.wait(id, call.agent, Math.min(requested, config.maxWaitTimeoutMs), call.signal)
      }
      const result = jobs.read(id, call.agent)
      const body = result.output.length > 0 ? result.output : '(no output yet)'
      const suffix = `${result.truncated ? '\n[older output truncated]' : ''}\n${status(result.snapshot)}`
      return { text: bounded(body, config.maxOutputBytes, suffix, 'tail'), truncated: result.truncated
        || Buffer.byteLength(`${body}${suffix}`, 'utf8') > config.maxOutputBytes,
      jobs: [jobValue(result.snapshot)] }
    },
  }, {
    output,
    schema: {
      name: 'job_list', description: 'List background jobs owned by this Agent.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    execute(call) {
      argumentsObject(call.arguments, [])
      const owned = jobs.list(call.agent)
      return Promise.resolve({ text: bounded(owned.length === 0
        ? '(no background jobs)'
        : owned.map(job => `${job.id} [${job.kind}] ${job.status} — ${job.label}`).join('\n'), config.maxOutputBytes), jobs: owned.map(jobValue) })
    },
  }, {
    output,
    schema: {
      name: 'job_kill', description: 'Request cancellation of one background job owned by this Agent.',
      parameters: { type: 'object', properties: { job_id: { type: 'string' }, reason: { type: 'string' } },
        required: ['job_id'], additionalProperties: false },
    },
    execute(call) {
      const args = argumentsObject(call.arguments, ['job_id', 'reason'])
      const id = jobId(args.job_id)
      if (args.reason !== undefined && typeof args.reason !== 'string') throw new Error('native-tool-jobs: reason must be a string')
      const outcome = jobs.cancel(id, call.agent, args.reason)
      return Promise.resolve({ text: outcome === 'requested'
        ? `requested cancellation of job ${id}`
        : `job ${id} had already finished ${status(jobs.get(id, call.agent))}`, jobs: [jobValue(jobs.get(id, call.agent))], outcome })
    },
  }]
}

/** Native job controls contribution selected alongside the job and tool registries. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-native-tool-jobs', targets: ['host'],
  requires: ['jobs', 'tools'], provides: ['jobControls'],
  resolve(input) {
    const config = resolveConfig(input)
    return (context) => {
      const jobs = context.require('jobs')
      const tools = context.require('tools')
      for (const contribution of nativeJobTools(jobs, config)) context.effect(tools.registerValueTool(contribution, context.scope))
      context.provide('jobControls', { jobs })
    }
  },
}
