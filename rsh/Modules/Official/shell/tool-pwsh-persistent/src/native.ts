/* jscpd:ignore-start */
// Deliberate mirror of tool-bash-persistent (persistent-pty note 2026-08-11-pwsh-persistent-pty):
// the PowerShell counterpart shares the session registry, polling loop, and reset contract by design.
/** Native adapter for the owner-scoped persistent pwsh tool. */
import type { NativePlugin } from '@redspark/rsh-native-runtime'
import type { NativeAgent, NativeAgentRegistry } from '@redspark/rsh-native-agent'
import type {} from '@redspark/rsh-native-agent'
import type { NativeToolExecution, NativeValueToolContribution } from '@redspark/rsh-native-tools'
import type {} from '@redspark/rsh-native-tools/native'
import type { JsonSchemaNode } from '@redspark/rsh-native-tools/json-schema'
import type { NativeTerminalId, NativeTerminalRegistry } from '@redspark/rsh-terminal/native'
import type {} from '@redspark/rsh-terminal/native'
import {
  createPersistentPwshRuntime,
  resolvePersistentPwshConfig,
  type PersistentPwshConfigInput,
  type PersistentTerminalPorts,
} from './persistent-core.ts'

const PREFIX = 'tool-pwsh-persistent'
const FIELDS = ['backendType', 'timeoutMs', 'maxOutputChars', 'description'] as const
const outputSchema: JsonSchemaNode = { type: 'string' }

function nativeConfig(input: unknown): PersistentPwshConfigInput {
  if (input === undefined) return {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error(`${PREFIX}: native configuration must be an object`)
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!(FIELDS as readonly string[]).includes(key)) {
      throw new Error(`${PREFIX}: unsupported native configuration field ${key}`)
    }
  }
  if (fields.backendType !== undefined && typeof fields.backendType !== 'string') {
    throw new Error(`${PREFIX}: backendType must be a string`)
  }
  if (fields.timeoutMs !== undefined && typeof fields.timeoutMs !== 'number') {
    throw new Error(`${PREFIX}: timeoutMs must be a number`)
  }
  if (fields.maxOutputChars !== undefined && typeof fields.maxOutputChars !== 'number') {
    throw new Error(`${PREFIX}: maxOutputChars must be a number`)
  }
  if (fields.description !== undefined && typeof fields.description !== 'string') {
    throw new Error(`${PREFIX}: description must be a string`)
  }
  return {
    ...fields.backendType === undefined ? {} : { backendType: fields.backendType },
    ...fields.timeoutMs === undefined ? {} : { timeoutMs: fields.timeoutMs },
    ...fields.maxOutputChars === undefined ? {} : { maxOutputChars: fields.maxOutputChars },
    ...fields.description === undefined ? {} : { description: fields.description },
  }
}

function contribution(
  config: ReturnType<typeof resolvePersistentPwshConfig>,
  runtime: ReturnType<typeof createPersistentPwshRuntime<NativeAgent, NativeTerminalId>>,
  terminals: NativeTerminalRegistry,
): NativeValueToolContribution {
  return {
    schema: {
      name: 'pwsh',
      description: config.description,
      parameters: {
        type: 'object',
        required: ['command'],
        additionalProperties: false,
        properties: {
          command: { type: 'string', description: 'The PowerShell command to run. Relative path is preferred in the command.' },
        },
      },
    },
    output: {
      schema: outputSchema,
      render: (_call, value) => ({ isError: false, content: [{ type: 'text', text: value as string }] }),
    },
    async execute(call) {
      const command = commandOf(call)
      return runtime.execute(call.agent, command, call.signal, async (signal) => {
        const opened = await terminals.open(call.agent, call.session, config.backendType, call.session.header.cwd, signal)
        return opened.sessionId
      })
    },
  }
}

function commandOf(call: NativeToolExecution): string {
  const command = (call.arguments as { command: string }).command
  if (command.trim().length === 0) throw new Error('command must be a non-empty string')
  return command
}

function ports(
  terminals: NativeTerminalRegistry,
  agents: NativeAgentRegistry,
  own: (cleanup: () => Promise<void>) => void,
): PersistentTerminalPorts<NativeAgent, NativeTerminalId> {
  return {
    status(owner, id) {
      const status = terminals.list(owner).find(session => session.sessionId === id)?.status
      if (status === undefined) return undefined
      if (status === 'running') return { kind: 'running', exitCode: null, signal: null }
      return { kind: 'exited', exitCode: null, signal: null }
    },
    async close(owner, id, _reason) {
      if (!terminals.list(owner).some(session => session.sessionId === id)) return
      await terminals.close(owner, id)
    },
    startSend: (owner, id, request) => terminals.startSend(owner, id, request),
    read: (owner, id, request) => terminals.read(owner, id, request),
    onDispose(cleanup) {
      own(cleanup)
    },
    onOwnerDispose(owner, cleanup) {
      agents.onDispose(owner, cleanup)
    },
  }
}

/** Native installer for the persistent pwsh tool. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@redspark/rsh-tool-pwsh-persistent',
  targets: ['host'],
  requires: ['agents', 'terminals', 'tools'],
  provides: [],
  resolve(input) {
    const config = resolvePersistentPwshConfig(nativeConfig(input), PREFIX)
    return (context) => {
      const terminals = context.require('terminals')
      const agents = context.require('agents')
      const tools = context.require('tools')
      const runtime = createPersistentPwshRuntime(ports(terminals, agents, (cleanup) => { context.own(cleanup) }), config)
      context.effect(tools.registerValueTool(contribution(config, runtime, terminals), context.scope))
    }
  },
}
/* jscpd:ignore-end */
