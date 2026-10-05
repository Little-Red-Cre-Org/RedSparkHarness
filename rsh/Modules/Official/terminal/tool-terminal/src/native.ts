/** Native model tools for the first terminal lifecycle capability. */
import { isAbsolute } from 'node:path'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeToolExecution, NativeValueToolContribution } from '@deepseek-ai/dsh-native-tools'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import { NativeTerminalId } from '@deepseek-ai/dsh-terminal/native'
import type {} from '@deepseek-ai/dsh-terminal/native'

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
    pid: { type: 'integer' as const }, status: { type: 'string' as const, enum: ['running', 'exited', 'failed'] },
  },
}

function content(text: string) { return { isError: false, content: [{ type: 'text' as const, text }] } }

/** Install open, list, and close; send, read, and signal need the later interaction batch. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-terminal', targets: ['host'],
  requires: ['terminals', 'tools'], provides: [],
  resolve(input) {
    if (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).some(key => key !== 'type')) throw new Error('tool-terminal: native configuration requires only type')
    const type = (input as Record<string, unknown>).type
    if (typeof type !== 'string' || type.trim().length === 0) throw new Error('tool-terminal: type must be nonempty')
    return (context) => {
      const terminals = context.require('terminals')
      const tools = context.require('tools')
      const register = (contribution: NativeValueToolContribution): void => {
        context.effect(tools.registerValueTool(contribution, context.scope))
      }
      register({
        schema: { name: 'terminal_open', description: 'Allocate an owner-scoped PTY process. This lifecycle-only tool does not send input or read output.',
          parameters: { type: 'object', required: ['type'], additionalProperties: false, properties: {
            type: { type: 'string', enum: [type], description: 'Configured terminal backend type.' },
            cwd: { type: 'string', description: 'Absolute initial working directory.' },
          } } },
        output: { schema: snapshotSchema, render: (_call, value) => {
          const session = value as unknown as { sessionId: string; pid: number }
          return content(`opened terminal ${session.sessionId} (${session.pid === 0 ? 'pid pending' : `pid ${session.pid}`}); interactive input and output are unavailable in this profile`)
        } },
        execute(call) {
          const args = argumentsObject(call, ['type', 'cwd'])
          if (requiredText(args.type, 'type') !== type) throw new Error(`tool-terminal: type must be ${type}`)
          const cwd = args.cwd === undefined ? undefined : requiredText(args.cwd, 'cwd')
          if (cwd !== undefined && !isAbsolute(cwd)) throw new Error('tool-terminal: cwd must be absolute')
          return terminals.open(call.agent, call.session, type, cwd, call.signal)
        },
      })
      register({
        schema: { name: 'terminal_list', description: 'List PTY processes owned by this Agent.',
          parameters: { type: 'object', properties: {}, additionalProperties: false } },
        output: { schema: { type: 'array', items: snapshotSchema }, render: (_call, value) => {
          const sessions = value as unknown as Array<{ sessionId: string; status: string }>
          return content(sessions.length === 0 ? '(no terminal sessions)'
            : sessions.map(session => `${session.sessionId} [${session.status}]`).join('\n'))
        } },
        execute(call) {
          argumentsObject(call, [])
          return Promise.resolve(terminals.list(call.agent))
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
          return content(result.closed ? `closed terminal ${result.sessionId}` : `terminal ${result.sessionId} was already closing`)
        } },
        async execute(call) {
          const id = NativeTerminalId(requiredText(argumentsObject(call, ['sessionId']).sessionId, 'sessionId'))
          return { sessionId: id, closed: await terminals.close(call.agent, id) }
        },
      })
    }
  },
}
