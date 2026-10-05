/** Native model-facing PowerShell tool over one selected shell Provider. */
/* jscpd:ignore-start -- PowerShell mirrors the Bash tool lifecycle with a distinct command dialect. */
import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { NativeValueToolContribution, NativeToolExecution } from '@deepseek-ai/dsh-native-tools'
import type { NativeJobRegistry } from '@deepseek-ai/dsh-native-jobs'
import type {} from '@deepseek-ai/dsh-native-tools/native'
import type {} from '@deepseek-ai/dsh-native-jobs'
import type {} from '@deepseek-ai/dsh-native-tool-jobs/native'
import type { ShellEnvironment } from '@deepseek-ai/dsh-shell-env/definition'
import type {} from '@deepseek-ai/dsh-pwsh-local/native'
import type {} from '@deepseek-ai/dsh-native-sandbox-policy/native'
import type {} from '@deepseek-ai/dsh-native-approval/native'
import { ESCALATION_TARGETS, approveEscalation, canonicalPath, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox/native'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox/native'
import { canonicalShellResult, type ShellOperations, type ShellRunResult } from '@deepseek-ai/dsh-shell/native'
import { renderPwshProcessRead as renderProcessRead, renderPwshResult as renderResult } from './render.ts'
import { processOutcome } from './background.ts'

interface PowerShellArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
  sandbox_permissions?: string
  justification?: string
}

function parseArgs(input: unknown): PowerShellArgs {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('tool-pwsh: arguments must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (!['command', 'description', 'timeoutMs', 'workdir', 'run_in_background', 'sandbox_permissions', 'justification'].includes(key)) {
      throw new Error(`tool-pwsh: unexpected argument ${key}`)
    }
  }
  if (typeof fields.command !== 'string' || fields.command.trim().length === 0) {
    throw new Error('invalid command: expected a non-empty string')
  }
  if (typeof fields.description !== 'string' || fields.description.trim().length === 0) {
    throw new Error('invalid description: expected a non-empty string')
  }
  if (fields.timeoutMs !== undefined && (typeof fields.timeoutMs !== 'number' || !Number.isFinite(fields.timeoutMs) || fields.timeoutMs <= 0)) {
    throw new Error('invalid timeoutMs: expected a positive number')
  }
  if (fields.workdir !== undefined && typeof fields.workdir !== 'string') throw new Error('tool-pwsh: workdir must be a string')
  if (fields.run_in_background !== undefined && typeof fields.run_in_background !== 'boolean') {
    throw new Error('tool-pwsh: run_in_background must be a boolean')
  }
  if (fields.sandbox_permissions !== undefined && typeof fields.sandbox_permissions !== 'string') {
    throw new Error('tool-pwsh: sandbox_permissions must be a string')
  }
  if (fields.justification !== undefined && typeof fields.justification !== 'string') {
    throw new Error('tool-pwsh: justification must be a string')
  }
  const args = fields as unknown as PowerShellArgs
  validateEscalationArgs(args.sandbox_permissions, args.justification)
  return args
}

function workdir(call: NativeToolExecution, requested: string | undefined, policy: SandboxExecutionPolicy | undefined): string | undefined {
  const headerCwd = call.session.header.cwd
  const sessionCwd = policy?.workspaceRoot ?? (headerCwd === undefined ? undefined : canonicalPath(headerCwd))
  if (requested === undefined) return sessionCwd
  if (sessionCwd !== undefined && !isAbsolute(requested)) return resolvePath(sessionCwd, requested)
  return requested
}

async function policyFor(
  call: NativeToolExecution, args: PowerShellArgs, standing: SandboxExecutionPolicy | undefined,
): Promise<SandboxExecutionPolicy | undefined> {
  if (args.sandbox_permissions === undefined || args.justification === undefined) return standing
  if (standing === undefined) {
    throw new Error('sandbox_permissions is not available in this composition (no sandboxing executor to escalate)')
  }
  const requestApproval = call.requestApproval
  const mode = await approveEscalation(
    { requestedMode: args.sandbox_permissions, justification: args.justification, effectiveMode: standing.mode, subject: 'command' },
    {
      approver: requestApproval === undefined ? undefined : {
        request: ({ reason }) => requestApproval({ reason }, call.signal),
      },
      agent: call.agent, callId: call.callId, toolName: 'pwsh', signal: call.signal,
    },
  )
  return { ...standing, mode }
}

function description(escalationModes: readonly SandboxMode[], backgroundEnabled: boolean): string {
  const base = 'Execute a fresh PowerShell command and return stdout, stderr, and an exit marker. '
    + 'Use native Windows paths and $env:NAME variables; pass workdir instead of cd. '
    + 'Nonzero exits are results, while process failures are errors. '
    + 'A file sandbox may deny access; inspect the denial marker and do not work around it.'
  const background = backgroundEnabled
    ? ' Set run_in_background for longer work; use job_output to read its final output and job_kill to stop it.'
    : ''
  if (escalationModes.length === 0) return base + background
  return base + background + ' On Windows, restricted execution uses ConstrainedLanguageMode and blocks unsafe named-pipe access. '
    + 'After a real denial, retry the exact command once with the narrowest wider '
    + 'sandbox_permissions and a one-sentence justification; the approval prompt asks the user. '
    + 'A rejected escalation is final for that command.'
}

function contribution(
  shell: ShellOperations,
  resolvePolicy: (call: NativeToolExecution) => SandboxExecutionPolicy | undefined,
  jobs: NativeJobRegistry | undefined,
  shellEnv: ShellEnvironment<NativeToolExecution>,
  canRequestApproval: boolean,
): NativeValueToolContribution {
  const escalationModes: readonly SandboxMode[] = shell.sandboxMode === undefined || !canRequestApproval ? [] : ESCALATION_TARGETS
  return {
    schema: {
      name: 'pwsh', description: description(escalationModes, jobs !== undefined),
      parameters: { type: 'object', properties: {
        command: { type: 'string', description: 'PowerShell source to run in a fresh shell.' },
        description: { type: 'string', description: 'Brief description of the command for the user.' },
        timeoutMs: { type: 'number', description: 'Foreground timeout in milliseconds, capped by the executor.' },
        workdir: { type: 'string', description: 'Working directory; relative paths use the Session workspace.' },
        ...jobs === undefined ? {} : {
          run_in_background: { type: 'boolean' as const, description: 'Start a managed job without a command timeout.' },
        },
        ...escalationModes.length > 0 ? {
          sandbox_permissions: { type: 'string' as const, enum: [...escalationModes], description: 'Wider file-access mode for a denied command.' },
          justification: { type: 'string' as const, description: 'One sentence explaining why the exact command needs wider access.' },
        } : {},
      }, required: ['command', 'description'], additionalProperties: false },
    },
    output: {
      schema: { oneOf: [
        { type: 'object', properties: { kind: { type: 'string', const: 'background' }, jobId: { type: 'string' } },
          required: ['kind', 'jobId'], additionalProperties: false },
        { type: 'object', properties: {
          kind: { type: 'string', const: 'foreground' },
          exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          timedOut: { type: 'boolean' }, aborted: { type: 'boolean' }, timeoutMs: { type: 'number' },
          stdout: { type: 'object', properties: { text: { type: 'string' }, truncated: { type: 'boolean' }, spillPath: { type: 'string' } },
            required: ['text', 'truncated'], additionalProperties: false },
          stderr: { type: 'object', properties: { text: { type: 'string' }, truncated: { type: 'boolean' }, spillPath: { type: 'string' } },
            required: ['text', 'truncated'], additionalProperties: false },
          sandbox: { type: 'object', properties: { mode: { type: 'string' }, denied: { type: 'boolean' },
            enforcement: { type: 'string' }, runnerFailed: { type: 'boolean' } }, required: ['mode', 'denied'], additionalProperties: false },
        }, required: ['kind', 'exitCode', 'signal', 'timedOut', 'aborted', 'timeoutMs', 'stdout', 'stderr'], additionalProperties: false },
      ] },
      render(_call, canonical) {
        const value = canonical as unknown as { kind: 'background'; jobId: string } | ({ kind: 'foreground' } & ShellRunResult)
        return { content: [{ type: 'text', text: value.kind === 'background'
          ? `started background job ${value.jobId}` : renderResult(value, escalationModes) }], isError: false }
      },
    },
    async execute(call) {
      const args = parseArgs(call.arguments)
      const standing = resolvePolicy(call)
      const policy = await policyFor(call, args, standing)
      const cwd = workdir(call, args.workdir, standing)
      const dshEnv = shellEnv.collect(call)
      const request = {
        command: args.command, dshEnv,
        ...cwd === undefined ? {} : { workdir: cwd },
        ...args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs },
        ...policy === undefined ? {} : { sandboxPolicy: policy },
      }
      if (args.run_in_background === true) {
        if (jobs === undefined) throw new Error('tool-pwsh: background jobs are unavailable in this composition')
        call.signal.throwIfAborted()
        const id = jobs.start({ agent: call.agent, kind: 'pwsh', label: args.command, async run(signal) {
          const proc = shell.start(shell.resolve({ ...request, signal }))
          await proc.done
          const output = renderProcessRead(proc.readOutput(), proc.sandbox, escalationModes)
          const outcome = processOutcome(proc)
          return {
            status: proc.sandbox?.runnerFailed === true ? 'failed'
              : proc.status === 'killed' ? signal.aborted ? 'cancelled' : 'failed' : 'completed',
            detail: outcome.detail, output,
          }
        } })
        return { kind: 'background', jobId: id }
      }
      const result = await shell.run(shell.resolve({ ...request, signal: call.signal }))
      if (result.aborted) throw new Error('tool-pwsh: command aborted')
      return { kind: 'foreground', ...canonicalShellResult(result) }
    },
  }
}

/** Register a foreground PowerShell tool after its shell and policy services are selected. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@deepseek-ai/dsh-tool-pwsh', targets: ['host'],
  requires: ['shell', 'tools', 'shellEnv'], optional: ['sandboxPolicy', 'approval', 'jobs', 'jobControls'], provides: [],
  resolve(input) {
    if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).length > 0)) throw new Error('tool-pwsh: native configuration must be empty')
    return (context) => {
      const shell = context.require('shell')
      const policy = context.optional('sandboxPolicy')
      const jobs = context.optional('jobControls') === true ? context.optional('jobs') : undefined
      const approval = context.optional('approval')
      const shellEnv = context.require('shellEnv')
      if (shell.sandboxMode !== undefined && policy === undefined) {
        throw new Error('tool-pwsh: the selected shell confines but sandboxPolicy is missing')
      }
      context.effect(context.require('tools').registerValueTool(contribution(shell, call =>
        shell.sandboxMode === undefined ? undefined : policy?.resolve({ session: call.session }), jobs, shellEnv,
      approval?.policy === 'ask'), context.scope))
    }
  },
}
/* jscpd:ignore-end */
