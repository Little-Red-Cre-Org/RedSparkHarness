/**
 * One-shot Claude Code lifecycle: invoke the official Agent SDK, place its
 * real CLI process under the shared subprocess owner, map only strict SDK
 * success to completion, and dispose to whole-range quiescence.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/controller
 */

import {
  query as officialQuery,
  type HookInput,
  type Options,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SpawnOptions,
} from '@anthropic-ai/claude-agent-sdk'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  scrubbedParentEnv,
  type SubprocessHandle,
  type SubprocessOutcome,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess/native'
import {
  claudeSpawnSpec,
  ManagedClaudeCodeProcess,
} from './process.ts'

/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000

/** Claude Code permission modes that cannot wait for a human response. */
export const CLAUDE_CODE_PERMISSION_MODES = [
  'dontAsk',
  'acceptEdits',
  'auto',
  'plan',
  'bypassPermissions',
] as const satisfies readonly NonNullable<Options['permissionMode']>[]

/** Profile-selectable non-interactive Claude Code permission mode. */
export type ClaudeCodePermissionMode = typeof CLAUDE_CODE_PERMISSION_MODES[number]

/** Safe default for unattended Claude Code runs. */
export const DEFAULT_CLAUDE_CODE_PERMISSION_MODE: ClaudeCodePermissionMode = 'dontAsk'

const SUPPORTED_UNATTENDED_DIALOG_KINDS = [
  'refusal_fallback_prompt',
] satisfies NonNullable<Options['supportedDialogKinds']>

type ClaudeCodeFailureStage =
  | 'query-start'
  | 'query-run'
  | 'process'
  | 'teardown'

type ClaudeCodeFailureCategory =
  | 'limit'
  | 'product-error'
  | 'invalid-result'
  | 'process'
  | 'unknown'

interface ClaudeCodeFailureFacts {
  readonly stage: ClaudeCodeFailureStage
  readonly category: ClaudeCodeFailureCategory
  readonly outcome?: SubprocessOutcome | undefined
}

function failureDiagnostic(facts: ClaudeCodeFailureFacts): string {
  const fields = [
    'product: Claude Code',
    `stage: ${facts.stage}`,
    `category: ${facts.category}`,
  ]
  const exitCode = facts.outcome?.exitCode
  if (exitCode !== null && exitCode !== undefined) {
    fields.push(`exit code: ${exitCode}`)
  }
  const signal = facts.outcome?.signal
  if (signal !== null && signal !== undefined) {
    fields.push(`signal: ${signal}`)
  }
  return `Product subagent failure (${fields.join('; ')})`
}

class ClaudeCodeFailure extends Error {
  constructor(
    readonly facts: ClaudeCodeFailureFacts,
    cause?: unknown,
  ) {
    super(
      `subagent-claude-code: ${failureDiagnostic(facts)}`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'ClaudeCodeFailure'
  }
}

function sdkFailureCategory(
  subtype: string,
): ClaudeCodeFailureCategory {
  switch (subtype) {
    case 'error_max_turns':
    case 'error_max_budget_usd':
    case 'error_max_structured_output_retries':
      return 'limit'
    case 'error_during_execution':
      return 'product-error'
    default:
      return 'unknown'
  }
}

/**
 * Hide an unpublished product startup failure behind fixed safe facts.
 * @param cause - original host-side failure retained only on the Error cause chain.
 * @returns a rejection safe to expose through the subagent start boundary.
 */
export function claudeCodeStartupFailure(cause: unknown): Error {
  return new ClaudeCodeFailure({
    stage: 'query-start',
    category: 'unknown',
  }, cause)
}

function unattendedDiagnostic(
  mode: ClaudeCodePermissionMode,
  request: 'tool permission' | 'MCP elicitation' | 'user dialog',
  decision: 'denied' | 'declined' | 'cancelled',
  reason: string,
): string {
  return `Claude Code unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`
}

/* jscpd:ignore-start -- sibling providers intentionally keep product-private
 * run inputs and error normalization instead of adding a shared lifecycle owner. */
/** Fully resolved inputs for one official Claude Agent SDK query. */
export interface ClaudeCodeRunSpec {
  /** Parent Session workspace supplied to the SDK and real CLI. */
  readonly cwd: string
  /** Profile-selected native model; omitted to preserve Claude settings. */
  readonly model?: string
  /** Profile-selected native non-interactive permission mode. */
  readonly permissionMode: ClaudeCodePermissionMode
  /** Explicit deployment/test environment layered after shared scrubbing. */
  readonly env: Record<string, string>
  /** Ambient environment names removed before the SDK starts the real CLI. */
  readonly removeAmbientEnv?: readonly string[]
  /** Native-only product ceilings and built-in tool selection. */
  readonly nativeExecution?: {
    readonly maxTurns: number
    readonly allowRead: boolean
    readonly workspaceRoot: string
  }
  /** Subprocess termination grace passed to the shared managed-range owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Host diagnostic sink for a product failure kept outside model-visible text. */
  readonly onError?: (error: Error) => void
}

function thrown(value: unknown): Error {
  /* v8 ignore next -- typed SDK and subprocess failures reject with Error. */
  return value instanceof Error ? value : new Error(String(value))
}

/** Read live request cancellation across awaited startup cleanup. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/* jscpd:ignore-end */

/**
 * Validate and preserve the one-shot task before crossing the SDK boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact text sequence as one SDK prompt.
 */
export function textTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error('subagent-claude-code: the one-shot task must contain only text blocks')
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error('subagent-claude-code: the one-shot task must contain only text blocks')
    }
    texts.push(block.text)
  }
  if (texts.every(text => text.trim().length === 0)) {
    throw new Error('subagent-claude-code: the one-shot task must not be empty')
  }
  return texts.join('')
}

/**
 * Strictly derive the only SDK result that can complete a shared run.
 * @param message - an official discriminated result union.
 * @returns exact final text for a successful, non-error result.
 */
export function successfulResult(message: SDKResultMessage): string {
  if (message.subtype !== 'success') {
    const category = sdkFailureCategory(message.subtype)
    const detail = category === 'unknown'
      ? undefined
      : message.errors.join('; ')
    throw new ClaudeCodeFailure(
      { stage: 'query-run', category },
      detail === undefined || detail.length === 0
        ? undefined
        : new Error(detail),
    )
  }
  if (message.is_error || message.result.trim().length === 0) {
    throw new ClaudeCodeFailure({
      stage: 'query-run',
      category: 'invalid-result',
    })
  }
  return message.result
}

/**
 * Consume the complete SDK stream and require one strict success plus normal
 * iterator completion.
 * @param query - published official SDK query.
 * @param onPermissionDenied - records a safe fact when the SDK reports native denial.
 * @param onResult - records that the SDK supplied a terminal result message.
 * @returns the completed shared result.
 */
export async function consumeClaudeQuery(
  query: AsyncIterable<SDKMessage>,
  onPermissionDenied?: () => void,
  onResult?: () => void,
  onReady?: (sessionId: string) => void,
): Promise<string> {
  let answer: string | undefined
  for await (const message of query) {
    if (message.type === 'system' && message.subtype === 'init') {
      onReady?.(message.session_id)
      continue
    }
    if (message.type === 'system' && message.subtype === 'permission_denied') {
      onPermissionDenied?.()
      continue
    }
    if (message.type !== 'result') continue
    onResult?.()
    answer = successfulResult(message)
  }
  if (answer === undefined) {
    throw new ClaudeCodeFailure({
      stage: 'query-run',
      category: 'invalid-result',
    })
  }
  return answer
}

/**
 * Close the official query, terminate the managed range, and wait for the
 * subprocess owner to prove it is quiescent.
 * @param query - official SDK query, when creation reached that point.
 * @param child - shared-service handle that owns the CLI managed range, including
 * a published handle whose direct result later rejects.
 */
export async function disposeClaudeCodeChild(
  query: Pick<Query, 'close'> | undefined,
  child: SubprocessHandle,
): Promise<void> {
  const failures: Error[] = []
  let outcome: SubprocessOutcome | undefined
  void child.done.then(
    (value) => { outcome = value },
    () => {},
  )
  try {
    query?.close()
  } catch (error: unknown) {
    failures.push(thrown(error))
  }

  child.terminate()
  try {
    await child.waitForExit()
  } catch (error: unknown) {
    failures.push(thrown(error))
  }

  const firstFailure = failures[0]
  if (firstFailure !== undefined) {
    const facts = {
      stage: 'teardown',
      category: 'unknown',
      outcome,
    } as const
    const cause = failures.length === 1
      ? firstFailure
      : new AggregateError(failures, 'Claude Code teardown failures')
    throw new ClaudeCodeFailure(facts, cause)
  }
  await child.done.catch(() => {})
}

/**
 * Build the fixed official SDK options for one one-shot provider run.
 * @param spec - Workspace, environment, process service, and disposal policy.
 * @param controller - per-run cancellation owner.
 * @param capture - receives the shared child and SDK-facing process synchronously.
 * @param captureDiagnostic - receives safe facts from unattended interaction callbacks.
 * @returns options that inherit native settings while disabling persistence and user questions.
 */
export function claudeQueryOptions(
  spec: ClaudeCodeRunSpec,
  controller: AbortController,
  capture: (
    child: SubprocessHandle,
    process: ManagedClaudeCodeProcess,
  ) => void,
  captureDiagnostic: (diagnostic: string) => void,
): Options {
  const nativeExecution = spec.nativeExecution
  const withinWorkspace = (input: HookInput): boolean => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Read'
      || typeof input.tool_input !== 'object' || input.tool_input === null
      || Array.isArray(input.tool_input)) return false
    const filePath = (input.tool_input as Record<string, unknown>)['file_path']
    if (typeof filePath !== 'string') return false
    try {
      const requested = realpathSync.native(isAbsolute(filePath) ? filePath : resolve(spec.cwd, filePath))
      const workspaceRoot = nativeExecution?.workspaceRoot
      if (workspaceRoot === undefined) return false
      const fromRoot = relative(workspaceRoot, requested)
      return fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
    } catch {
      return false
    }
  }
  const removedAmbientEnv = new Set(spec.removeAmbientEnv ?? [])
  const env = Object.fromEntries(
    Object.entries(scrubbedParentEnv()).filter(([name]) => !removedAmbientEnv.has(name)),
  )
  Object.assign(env, spec.env)
  return {
    abortController: controller,
    cwd: spec.cwd,
    ...spec.model === undefined ? {} : { model: spec.model },
    env,
    persistSession: false,
    ...nativeExecution === undefined ? {} : {
      allowedTools: nativeExecution.allowRead ? ['Read'] : [],
      hooks: nativeExecution.allowRead ? {
        PreToolUse: [{
          matcher: 'Read',
          hooks: [async (input) => {
            const allowed = withinWorkspace(input)
            return {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse' as const,
                permissionDecision: allowed ? 'allow' as const : 'deny' as const,
                permissionDecisionReason: allowed
                  ? 'Read path is inside the parent workspace.'
                  : 'Read path is outside the parent workspace.',
              },
            }
          }],
        }],
      } : {},
      includeHookEvents: true,
      maxTurns: nativeExecution.maxTurns,
      mcpServers: {},
      plugins: [],
      settingSources: ['user'],
      strictMcpConfig: true,
      tools: nativeExecution.allowRead ? ['Read'] : [],
    },
    disallowedTools: spec.permissionMode === 'plan'
      ? ['AskUserQuestion', 'ExitPlanMode']
      : ['AskUserQuestion'],
    permissionMode: spec.permissionMode,
    ...spec.permissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {
        canUseTool: () => {
          captureDiagnostic(unattendedDiagnostic(
            spec.permissionMode,
            'tool permission',
            'denied',
            'the provider does not request human approval',
          ))
          return Promise.resolve({
            behavior: 'deny' as const,
            message: 'This unattended Claude Code subagent cannot request human approval.',
          })
        },
      },
    onElicitation: () => {
      captureDiagnostic(unattendedDiagnostic(
        spec.permissionMode,
        'MCP elicitation',
        'declined',
        'the provider does not collect interactive MCP input',
      ))
      return Promise.resolve({ action: 'decline' })
    },
    onUserDialog: () => {
      captureDiagnostic(unattendedDiagnostic(
        spec.permissionMode,
        'user dialog',
        'cancelled',
        'the provider does not render blocking dialogs',
      ))
      return Promise.resolve({ behavior: 'cancelled' as const })
    },
    supportedDialogKinds: SUPPORTED_UNATTENDED_DIALOG_KINDS,
    spawnClaudeCodeProcess: (options: SpawnOptions) => {
      const child = spec.spawn(claudeSpawnSpec(options, spec.disposeGraceMs))
      const process = new ManagedClaudeCodeProcess(child)
      capture(child, process)
      return process
    },
  }
}

/**
 * One official Claude Agent SDK query and its real process range.
 * @param ready - resolves with the SDK's real Claude session identity.
 * @param result - resolves with the strict final answer or rejects with safe failure facts.
 * @param abort - cancel the SDK query.
 * @param dispose - terminate the complete managed range and await quiescence.
 */
export interface ClaudeCodeProductRun {
  readonly ready: Promise<string>
  readonly result: Promise<string>
  readonly onAbort: () => void
  abort(): void
  dispose(): Promise<void>
  collectOutput(): ContentBlock[]
  collectDiagnostic(): string | undefined
}

/**
 * Start the official SDK query once and share its lifecycle between compatibility
 * and Native adapters.
 * @param prompt - exact one-shot text task.
 * @param spec - product model, environment, process owner, and diagnostics.
 * @param signal - caller cancellation captured for the query and process range.
 * @returns the product query after the SDK-spawned CLI handle exists.
 */
export async function startClaudeCodeProductRun(
  prompt: string,
  spec: ClaudeCodeRunSpec,
  signal: AbortSignal,
): Promise<ClaudeCodeProductRun> {
  if (prompt.trim().length === 0) {
    throw new Error('subagent-claude-code: the one-shot task must not be empty')
  }
  if (signal.aborted) {
    throw new Error('subagent-claude-code: request was aborted before SDK startup')
  }

  const controller = new AbortController()
  const requestCancel = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(new Error('subagent-claude-code: run cancelled locally'))
    }
  }
  const onAbort = (): void => { requestCancel() }
  signal.addEventListener('abort', onAbort, { once: true })
  const reportFailure = (error: Error): void => {
    try {
      spec.onError?.(error)
    } catch {
      // Host diagnostic logging cannot replace the product failure.
    }
  }

  let child: SubprocessHandle | undefined
  let childFailure: Error | undefined
  let childProcessFailure: Promise<never> | undefined
  let query: Query | undefined
  let managedProcess: ManagedClaudeCodeProcess | undefined
  let diagnostic: string | undefined
  const capturePermissionDiagnostic = (value: string): void => {
    diagnostic = value
  }
  const prependFailureDiagnostic = (facts: ClaudeCodeFailureFacts): void => {
    const failure = failureDiagnostic(facts)
    diagnostic = diagnostic === undefined
      ? failure
      : `${failure}\n${diagnostic}`
  }
  const captureChild = (
    captured: SubprocessHandle,
    process: ManagedClaudeCodeProcess,
  ): void => {
    child = captured
    managedProcess = process
    childProcessFailure = captured.done.then(
      () => new Promise<never>(() => {}),
      (error: unknown) => {
        childFailure = thrown(error)
        throw childFailure
      },
    )
    void childProcessFailure.catch(() => {})
  }
  try {
    query = officialQuery({
      prompt,
      options: claudeQueryOptions(
        spec,
        controller,
        captureChild,
        capturePermissionDiagnostic,
      ),
    })
    if (child === undefined || childProcessFailure === undefined) {
      throw new Error(
        'subagent-claude-code: official SDK did not publish a controllable Claude Code process',
      )
    }
    if (isAborted(controller.signal)) {
      throw new Error('subagent-claude-code: request was aborted before SDK startup')
    }
  } catch (error: unknown) {
    signal.removeEventListener('abort', onAbort)
    const cancelledBeforeCleanup = controller.signal.aborted
    // Let child.done publish a concurrently observed exit before classification.
    await Promise.resolve()
    const startupOutcome = managedProcess?.outcome
    const startupFacts = {
      stage: 'query-start',
      category: 'unknown',
      outcome: startupOutcome,
    } as const
    const startupFailure = (cause: unknown = childFailure ?? error): ClaudeCodeFailure => new ClaudeCodeFailure(
      startupFacts,
      thrown(cause),
    )
    requestCancel()
    if (child !== undefined) {
      try {
        await disposeClaudeCodeChild(query, child)
      } catch (disposeError: unknown) {
        const failure = startupFailure()
        const cleanupFailure = thrown(disposeError)
        const aggregate = new AggregateError(
          [failure, cleanupFailure],
          `${failure.message}; ${cleanupFailure.message}`,
        )
        reportFailure(aggregate)
        throw aggregate
      }
      if (cancelledBeforeCleanup || isAborted(signal)) {
        throw new Error('subagent-claude-code: request was aborted before SDK startup')
      }
      const failure = startupFailure()
      reportFailure(failure)
      throw failure
    } else if (query !== undefined) {
      try {
        query.close()
      } catch (disposeError: unknown) {
        const failure = startupFailure()
        const cleanupFailure = new ClaudeCodeFailure({
          stage: 'teardown',
          category: 'unknown',
        }, thrown(disposeError))
        const aggregate = new AggregateError(
          [failure, cleanupFailure],
          `${failure.message}; ${cleanupFailure.message}`,
        )
        reportFailure(aggregate)
        throw aggregate
      }
    }
    if (cancelledBeforeCleanup || isAborted(signal)) {
      throw new Error('subagent-claude-code: request was aborted before SDK startup')
    }
    const failure = startupFailure()
    reportFailure(failure)
    throw failure
  }

  const publishedQuery = query
  const publishedChild = child
  const publishedProcessFailure = childProcessFailure
  let receivedResult = false
  let readySettled = false
  const readiness = Promise.withResolvers<string>()
  void readiness.promise.catch(() => {})
  const result = Promise.race([
    consumeClaudeQuery(publishedQuery, () => {
      capturePermissionDiagnostic(unattendedDiagnostic(
        spec.permissionMode,
        'tool permission',
        'denied',
        'Claude Code denied the request before an interactive prompt',
      ))
    }, () => {
      receivedResult = true
    }, (sessionId) => {
      if (readySettled) return
      if (sessionId.length === 0) {
        readySettled = true
        readiness.reject(new Error('subagent-claude-code: SDK init omitted its Claude session identity'))
      } else {
        readySettled = true
        readiness.resolve(sessionId)
      }
    }),
    publishedProcessFailure,
  ]).catch((error: unknown): never => {
    const processOutcome = managedProcess?.outcome
    let facts: ClaudeCodeFailureFacts
    if (error instanceof ClaudeCodeFailure) {
      facts = { ...error.facts, outcome: processOutcome }
    } else if (processOutcome !== undefined && !receivedResult) {
      facts = {
        stage: 'process',
        category: 'process',
        outcome: processOutcome,
      }
    } else {
      facts = {
        stage: 'query-run',
        category: 'unknown',
        outcome: processOutcome,
      }
    }
    prependFailureDiagnostic(facts)
    const failure = error instanceof ClaudeCodeFailure
      ? error
      : new ClaudeCodeFailure(facts, thrown(error))
    if (!readySettled) {
      readySettled = true
      readiness.reject(failure)
    }
    throw failure
  })
  void result.then(() => {
    if (readySettled) return
    readySettled = true
    readiness.reject(new Error('subagent-claude-code: SDK query completed without a Claude session identity'))
  }, () => {})

  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> => disposal ??= (async () => {
    signal.removeEventListener('abort', onAbort)
    requestCancel()
    try {
      await disposeClaudeCodeChild(publishedQuery, publishedChild)
    } catch (error: unknown) {
      const failure = thrown(error)
      reportFailure(failure)
      throw failure
    }
  })()

  return {
    ready: readiness.promise,
    result,
    onAbort,
    abort: requestCancel,
    dispose,
    collectOutput: () => [],
    collectDiagnostic: () => diagnostic,
  }
}
