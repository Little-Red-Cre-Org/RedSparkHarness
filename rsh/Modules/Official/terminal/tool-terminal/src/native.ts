/** Native persistent terminal tools with the shared bounded result rendering. */
import { isAbsolute } from 'node:path'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution, NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-native-tools/json-schema'
import { NativeTerminalId } from '@deepseek-ai/dsh-terminal/native'
import type {} from '@deepseek-ai/dsh-terminal/native'
import type {} from '@deepseek-ai/dsh-native-jobs'
import type {} from '@deepseek-ai/dsh-native-prompt/native'
import type { TerminalReadResult, TerminalSendResult, TerminalSignal } from '@deepseek-ai/dsh-terminal/protocol'
import { boundTerminalText, renderRead, renderSend } from './render.ts'

function argumentsObject(call: NativeToolExecution, allowed: readonly string[]): Record<string, unknown> {
  if (typeof call.arguments !== 'object' || call.arguments === null || Array.isArray(call.arguments)) {
    throw new Error('tool-terminal: arguments must be an object')
  }
  const fields = call.arguments as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key)) throw new Error(`tool-terminal: unexpected argument ${key}`)
  }
  return fields
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`tool-terminal: ${field} must be nonempty text`)
  return value
}

const snapshotSchema = {
  type: 'object' as const, required: ['sessionId', 'type', 'pid', 'status'], additionalProperties: false,
  properties: {
    sessionId: { type: 'string' as const }, type: { type: 'string' as const },
    name: { type: 'string' as const }, motd: { type: 'string' as const },
    pid: { type: 'integer' as const }, status: { type: 'string' as const, enum: ['running', 'exited', 'failed'] },
  },
}

const sessionStatusSchema: JsonSchemaNode = { oneOf: [
  { type: 'object', required: ['kind'], additionalProperties: false, properties: { kind: { type: 'string', const: 'running' } } },
  { type: 'object', required: ['kind', 'exitCode', 'signal'], additionalProperties: false, properties: {
    kind: { type: 'string', const: 'exited' }, exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
    signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
  } },
] }
const sendSchema: JsonSchemaNode = { oneOf: [
  { type: 'object', required: ['kind', 'jobId'], additionalProperties: false,
    properties: { kind: { type: 'string', const: 'background' }, jobId: { type: 'string' } } },
  { type: 'object', required: ['kind', 'viewport', 'waitReason', 'sessionStatus', 'truncated'], additionalProperties: false,
    properties: { kind: { type: 'string', const: 'foreground' }, viewport: { type: 'string' },
      waitReason: { type: 'string', enum: ['stdin_read', 'inferred_idle', 'timeout', 'session_exit'] },
      sessionStatus: sessionStatusSchema, truncated: { type: 'boolean' } } },
] }
const readSchema: JsonSchemaNode = { type: 'object', required: ['text', 'totalLines', 'lineBegin', 'lineEnd', 'truncated'], additionalProperties: false,
  properties: { text: { type: 'string' }, totalLines: { type: 'integer' }, lineBegin: { type: 'integer' },
    lineEnd: { type: 'integer' }, truncated: { type: 'boolean' } } }

function content(text: string) { return { isError: false, content: [{ type: 'text' as const, text }] } }

/** Install owner-scoped lifecycle and interactive operations; background work uses the selected Jobs Provider. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-terminal', targets: ['host'],
  requires: ['terminals', 'tools'], optional: ['jobs', 'promptSections'], provides: [],
  resolve(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).some(key => !['type', 'enableRunInBackground', 'maxResultBytes'].includes(key))) throw new Error('tool-terminal: invalid native configuration')
    const fields = input as Record<string, unknown>
    const type = fields.type
    const enableRunInBackground = fields.enableRunInBackground ?? true
    if (typeof enableRunInBackground !== 'boolean') throw new Error('tool-terminal: enableRunInBackground must be boolean')
    const maxResultBytes = fields.maxResultBytes ?? 256 * 1024
    if (typeof maxResultBytes !== 'number' || !Number.isSafeInteger(maxResultBytes) || maxResultBytes < 64) {
      throw new Error('tool-terminal: maxResultBytes must be a safe integer of at least 64')
    }
    if (typeof type !== 'string' || type.trim().length === 0) throw new Error('tool-terminal: type must be nonempty')
    return (context) => {
      const terminals = context.require('terminals')
      const tools = context.require('tools')
      const jobs = context.optional('jobs')
      if (enableRunInBackground && jobs === undefined) throw new Error('tool-terminal: background sends require the native Jobs Provider')
      const prompts = context.optional('promptSections')
      if (prompts !== undefined) context.effect(prompts.register({ name: 'tool:pty', order: 500, text: () =>
        'Use a terminal only for persistent state or interactive stdin. Close unused sessions. An inferred_idle or timeout result does not prove the foreground command exited.' }, context.scope))
      const boundedContent = (text: string) => content(boundTerminalText(text, maxResultBytes))
      const register = (contribution: NativeValueToolContribution): void => {
        context.effect(tools.registerValueTool(contribution, context.scope))
      }
      register({
        schema: { name: 'terminal_open', description: 'Allocate an owner-scoped PTY process. Input, retained output and foreground signals remain available until terminal_close.',
          parameters: { type: 'object', required: ['type'], additionalProperties: false, properties: {
            type: { type: 'string', enum: [type], description: 'Configured terminal backend type.' },
            cwd: { type: 'string', description: 'Absolute initial working directory.' },
            name: { type: 'string', description: 'Optional owner-local unique name.' },
          } } },
        output: { schema: snapshotSchema, render: (_call, value) => {
          const session = value as unknown as { sessionId: string; pid: number; motd?: string; name?: string }
          const label = session.name === undefined ? session.sessionId : `${session.sessionId} (${session.name})`
          return boundedContent(`opened terminal ${label} (${session.pid === 0 ? 'pid pending' : `pid ${session.pid}`})\n${session.motd ?? ''}`)
        } },
        execute(call) {
          const args = argumentsObject(call, ['type', 'cwd', 'name'])
          if (requiredText(args.type, 'type') !== type) throw new Error(`tool-terminal: type must be ${type}`)
          const cwd = args.cwd === undefined ? undefined : requiredText(args.cwd, 'cwd')
          if (cwd !== undefined && !isAbsolute(cwd)) throw new Error('tool-terminal: cwd must be absolute')
          const name = args.name === undefined ? undefined : requiredText(args.name, 'name')
          return terminals.open(call.agent, call.session, type, cwd, call.signal, name)
        },
      })
      register({
        schema: { name: 'terminal_list', description: 'List PTY processes owned by this Agent.',
          parameters: { type: 'object', properties: {}, additionalProperties: false } },
        output: { schema: { type: 'array', items: snapshotSchema }, render: (_call, value) => {
          const sessions = value as unknown as Array<{ sessionId: string; status: string }>
          return boundedContent(sessions.length === 0 ? '(no terminal sessions)'
            : sessions.map(session => `${session.sessionId} [${session.status}]`).join('\n'))
        } },
        execute(call) {
          argumentsObject(call, [])
          return Promise.resolve(terminals.list(call.agent))
        },
      })
      register({
        schema: { name: 'terminal_send', description: 'Send input to an owned persistent terminal; wait for stdin readiness, idle, timeout or shell exit. Idle does not prove command exit.',
          parameters: { type: 'object', required: ['sessionId', 'text'], additionalProperties: false, properties: {
            sessionId: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' },
            ...(enableRunInBackground ? { run_in_background: { type: 'boolean' as const } } : {}),
          } } },
        output: { schema: sendSchema, render: (_call, value) => {
          const result = value as unknown as ({ kind: 'foreground' } & TerminalSendResult) | { kind: 'background'; jobId: string }
          return result.kind === 'background' ? boundedContent(`started background job ${result.jobId}`)
            : { ...boundedContent(renderSend(result, maxResultBytes)), meta: {
              viewport: result.viewport, waitReason: result.waitReason, sessionStatus: result.sessionStatus, truncated: result.truncated,
            } }
        } },
        async execute(call) {
          const args = argumentsObject(call, ['sessionId', 'text', 'submit', 'run_in_background'])
          const id = NativeTerminalId(requiredText(args.sessionId, 'sessionId'))
          const request = { text: args.text as string, submit: args.submit === undefined ? true : args.submit as boolean }
          if (args.run_in_background === true) {
            if (!enableRunInBackground || jobs === undefined) throw new Error('tool-terminal: background sends are disabled')
            const jobId = jobs.start({ agent: call.agent, kind: 'pty-send', label: `${id}: ${request.text || '(input)'}`,
              async run(signal) {
                const operation = terminals.startSend(call.agent, id, { ...request, signal })
                try {
                  const result = await operation.done
                  return { status: signal.aborted ? 'cancelled' : 'completed',
                    detail: result.sessionStatus.kind === 'running' ? `wait: ${result.waitReason}` : 'session exited',
                    output: renderSend(result, maxResultBytes) }
                } catch (error) { return { status: 'failed', detail: error instanceof Error ? error.message : String(error) } }
              },
            })
            return { kind: 'background', jobId }
          }
          const operation = terminals.startSend(call.agent, id, { ...request, signal: call.signal })
          const result = await operation.done
          call.signal.throwIfAborted()
          return { kind: 'foreground', ...result }
        },
      })
      register({
        schema: { name: 'terminal_read', description: 'Read a bounded newest-relative page of retained terminal output without sending input.',
          parameters: { type: 'object', required: ['sessionId'], additionalProperties: false, properties: {
            sessionId: { type: 'string' }, offset: { type: 'integer' }, count: { type: 'integer' },
          } } },
        output: { schema: readSchema, render: (_call, value) =>
          boundedContent(renderRead(value as unknown as TerminalReadResult, maxResultBytes)) },
        execute(call) {
          const args = argumentsObject(call, ['sessionId', 'offset', 'count'])
          return Promise.resolve(terminals.read(call.agent, NativeTerminalId(requiredText(args.sessionId, 'sessionId')), {
            ...args.offset === undefined ? {} : { offset: args.offset as number },
            ...args.count === undefined ? {} : { count: args.count as number },
          }))
        },
      })
      register({
        schema: { name: 'terminal_signal', description: 'Signal the verified foreground process group; shell-targeted SIGKILL is rejected, use terminal_close.',
          parameters: { type: 'object', required: ['sessionId', 'signal'], additionalProperties: false, properties: {
            sessionId: { type: 'string' }, signal: { type: 'string', enum: ['SIGINT', 'SIGTERM', 'SIGKILL', 'SIGTSTP', 'SIGHUP'] },
          } } },
        output: { schema: { type: 'object', required: ['delivered', 'targetPgid'], additionalProperties: false,
          properties: { delivered: { type: 'boolean', const: true }, targetPgid: { type: 'integer' } } },
        render: (call, value) => boundedContent(`delivered ${(call.arguments as { signal: string }).signal} to foreground process group ${(value as unknown as { targetPgid: number }).targetPgid}`) },
        execute(call) {
          const args = argumentsObject(call, ['sessionId', 'signal'])
          return terminals.signal(call.agent, NativeTerminalId(requiredText(args.sessionId, 'sessionId')), args.signal as TerminalSignal)
        },
      })
      register({
        schema: { name: 'terminal_close', description: 'Close one owned PTY process and wait for provider-observed process cleanup.',
          parameters: { type: 'object', required: ['sessionId'], additionalProperties: false,
            properties: { sessionId: { type: 'string' } } } },
        output: { schema: { type: 'object', required: ['sessionId', 'closed'], additionalProperties: false,
          properties: { sessionId: { type: 'string' }, closed: { type: 'boolean' } } },
        render: (_call, value) => {
          const result = value as unknown as { sessionId: string; closed: boolean }
          return boundedContent(result.closed ? `closed terminal ${result.sessionId}` : `terminal ${result.sessionId} was already closing`)
        } },
        async execute(call) {
          const id = NativeTerminalId(requiredText(argumentsObject(call, ['sessionId']).sessionId, 'sessionId'))
          return { sessionId: id, closed: await terminals.close(call.agent, id) }
        },
      })
    }
  },
}
