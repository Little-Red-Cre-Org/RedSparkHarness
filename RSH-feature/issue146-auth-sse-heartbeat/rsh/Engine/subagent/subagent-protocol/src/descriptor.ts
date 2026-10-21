/**
 * The durable subagent-child descriptor: the versioned, model-hidden
 * `subagent/descriptor` session event that identifies every session-backed
 * subagent and records whether it is one-shot or continuable. Continuable
 * descriptors additionally preserve the declared composition required for
 * cold resume. V4 can retain an inherited logical-parent context for children
 * created below product-owned external operations. Providers persist it during
 * fresh materialization, before the child's first model request.
 *
 * The descriptor deliberately snapshots explicit fields rather than the
 * merge-extensible `AgentOptions` object: an unrelated extension value cannot
 * make continuation fail merely because it is not JSON, and later composition
 * inputs require a deliberate {@link SUBAGENT_DESCRIPTOR_VERSION} change. It
 * omits `subagentDepth` — cold resume trusts the persisted header's
 * `delegationDepth` as the monotone floor — and `outputSchema`, which belongs
 * to one activation's result contract rather than durable child composition.
 * Per-activation knobs such as `maxTokens` are omitted for the same reason as
 * `outputSchema`: they budget one activation. A V4 inherited context is
 * different: its `maxSteps` and `maxTokens` are persistent ancestor ceilings,
 * not the previous activation's remaining counters. Cold resume intersects
 * these stored ceilings and positive tool grants with the exact live parent's
 * current authority.
 *
 * @module @deepseek-ai/dsh-subagent/descriptor
 */

import { snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type { SessionEvent } from '@deepseek-ai/dsh-session/native'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/native'
/** Versioned descriptor tool visibility values. */
interface ToolRestriction { readonly allow?: readonly string[]; readonly deny?: readonly string[] }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable identity and lifecycle mode of a session-backed subagent child,
     * appended once by the establishing provider during fresh materialization,
     * before its first request. Continuable records also carry their
     * resumable composition. Log-only: it carries no `surfaceOp`, never enters
     * model history, and survives compaction.
     */
    'subagent/descriptor': SubagentDescriptorData
  }
}

/**
 * The current descriptor format version, stamped into every appended
 * `subagent/descriptor` event. The reader also accepts the explicit V3
 * continuable schema; any other version is unsupported.
 */
export const SUBAGENT_DESCRIPTOR_VERSION = 4
const PREVIOUS_SUBAGENT_DESCRIPTOR_VERSION = 3

/** Fields shared by every supported `subagent/descriptor` payload. */
interface SubagentDescriptorBase {
  /** Descriptor format version ({@link SUBAGENT_DESCRIPTOR_VERSION}). */
  readonly version: 3 | 4
  /** Whether the child is a terminal one-shot run or a resumable conversation. */
  readonly mode: 'one-shot' | 'continuable'
  /** The `ctx.subagents` provider name that established the child. */
  readonly provider: string
}

/** A session-backed subagent that cannot be cold-resumed after its run. */
export interface OneShotSubagentDescriptorData extends SubagentDescriptorBase {
  readonly mode: 'one-shot'
  /**
   * The initial delegation's short `description`, kept as the child's durable
   * creation label so enumeration can identify the conversation without
   * replaying parent tool results or exposing the child prompt.
   */
  readonly label?: string
}

/** A session-backed subagent whose declared composition supports cold resume. */
export interface ContinuableSubagentDescriptorData extends SubagentDescriptorBase {
  readonly mode: 'continuable'
  /** The initial delegation's short `description`, used for durable enumeration. */
  readonly label: string
  /** Resolved child `agentOptions.provider`, when one was declared. */
  readonly agentProvider?: string
  /** Resolved child `agentOptions.model`, when one was declared. */
  readonly agentModel?: string
  /** Resolved child `agentOptions.reasoningEffort`, when one was declared. */
  readonly agentReasoningEffort?: ReasoningEffortId
  /** Per-child persona that shadows the deployment persona on resume. */
  readonly persona?: string
  /** Child tool scoping reapplied on resume. */
  readonly toolFilter?: ToolRestriction
  /** Logical parent route, persistent ceilings and positive tool grants for an inherited child. */
  readonly delegationContext?: SubagentDelegationContext
}

/** Durable logical-parent authority needed to reconstruct an inherited child after cold resume. */
export interface SubagentDelegationContext {
  /** Logical depth of the parent that created the child. */
  readonly depth: number
  /** Resolved absolute recursion ceiling for the child. */
  readonly maxDepth: number
  /** Exact inherited workspace. */
  readonly cwd: string
  /** Parent's effective route; the descriptor's child route remains authoritative on resume. */
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: ReasoningEffortId
  /** Persistent inherited per-activation budget ceiling. */
  readonly maxSteps: number
  /** Persistent inherited per-activation token ceiling. */
  readonly maxTokens?: number
  /** Direct model-callable grants captured from the logical parent. */
  readonly toolNames: readonly string[]
  /** Builtin grants, kept distinct from same-named Registry contributions. */
  readonly builtinToolNames: readonly string[]
  /** Program-only business grants. */
  readonly programToolNames: readonly string[]
}

/** The supported durable subagent identity and optional continuation composition. */
export type SubagentDescriptorData =
  | OneShotSubagentDescriptorData
  | ContinuableSubagentDescriptorData

/** Fields shared by descriptor snapshot inputs. */
interface SubagentDescriptorInputBase {
  /** Whether the child is a terminal one-shot run or a resumable conversation. */
  readonly mode: 'one-shot' | 'continuable'
  /** The `ctx.subagents` provider name that will establish the child. */
  readonly provider: string
}

/** Input for a one-shot child's durable identity. */
export interface OneShotSubagentDescriptorInput extends SubagentDescriptorInputBase {
  readonly mode: 'one-shot'
  /** Optional initial delegation `description` used as the durable creation label. */
  readonly label?: string
}

/** Input for a continuable child's durable identity and resumable composition. */
export interface ContinuableSubagentDescriptorInput extends SubagentDescriptorInputBase {
  readonly mode: 'continuable'
  /** Initial delegation `description` used for durable enumeration. */
  readonly label: string
  /** Requested child `agentOptions.provider`. */
  readonly agentProvider?: string
  /** Requested child `agentOptions.model`. */
  readonly agentModel?: string
  /** Requested child `agentOptions.reasoningEffort`. */
  readonly agentReasoningEffort?: ReasoningEffortId
  /** Requested per-child persona. */
  readonly persona?: string
  /** Requested child tool scoping. */
  readonly toolFilter?: ToolRestriction
  /** Logical parent authority when this child descends from an inherited external operation. */
  readonly delegationContext?: SubagentDelegationContext
}

/** Inputs {@link snapshotSubagentDescriptor} validates and detaches. */
export type SubagentDescriptorInput =
  | OneShotSubagentDescriptorInput
  | ContinuableSubagentDescriptorInput

const DESCRIPTOR_BASE_KEYS = [
  'version',
  'mode',
  'provider',
  'label',
] as const
const ONE_SHOT_DESCRIPTOR_KEYS = new Set(DESCRIPTOR_BASE_KEYS)
const CONTINUABLE_DESCRIPTOR_KEYS = new Set([
  ...DESCRIPTOR_BASE_KEYS,
  'agentProvider',
  'agentModel',
  'agentReasoningEffort',
  'persona',
  'toolFilter',
  'delegationContext',
])
const V3_CONTINUABLE_DESCRIPTOR_KEYS = new Set([...CONTINUABLE_DESCRIPTOR_KEYS].filter(key => key !== 'delegationContext'))
const TOOL_FILTER_KEYS = new Set(['allow', 'deny'])
const DELEGATION_CONTEXT_KEYS = new Set([
  'depth', 'maxDepth', 'cwd', 'provider', 'model', 'reasoningEffort', 'maxSteps', 'maxTokens',
  'toolNames', 'builtinToolNames', 'programToolNames',
])

/** Whether a persisted JSON value is an object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reject fields outside one versioned record's declared schema. */
function assertKnownKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(value).find(key => !keys.has(key))
  if (unknown !== undefined) {
    throw new Error(`persisted subagent descriptor ${path} has unknown field "${unknown}"`)
  }
}

/** Read one optional string field from a persisted descriptor record. */
function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(value, key)) return undefined
  const field = value[key]
  if (typeof field !== 'string') {
    throw new Error(`persisted subagent descriptor ${key} must be a string`)
  }
  return field
}

/** Read one optional string-array field from a persisted tool restriction. */
function optionalStringArray(value: Record<string, unknown>, key: string): string[] | undefined {
  if (!Object.hasOwn(value, key)) return undefined
  const field = value[key]
  if (!Array.isArray(field)) {
    throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`)
  }
  const items: unknown[] = field
  if (items.some(item => typeof item !== 'string')) {
    throw new Error(`persisted subagent descriptor toolFilter.${key} must be an array of strings`)
  }
  return items as string[]
}

/** Read a persisted delegation-context name list and reject duplicates. */
function requiredNameList(value: Record<string, unknown>, key: string): readonly string[] {
  const field = value[key]
  if (!Array.isArray(field) || field.some(item => typeof item !== 'string')) {
    throw new Error(`persisted subagent descriptor delegationContext.${key} must be an array of strings`)
  }
  const names = field as string[]
  if (new Set(names).size !== names.length) {
    throw new Error(`persisted subagent descriptor delegationContext.${key} must contain unique names`)
  }
  return [...names]
}

/** Read a required safe-integer field from a persisted delegation context. */
function requiredInteger(value: Record<string, unknown>, key: string, minimum: number): number {
  const field = value[key]
  if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < minimum) {
    throw new Error(`persisted subagent descriptor delegationContext.${key} must be a safe integer >= ${minimum}`)
  }
  return field
}

/** Validate and detach a persisted logical-parent context. */
function parseDelegationContext(value: unknown): SubagentDelegationContext {
  if (!isRecord(value)) throw new Error('persisted subagent descriptor delegationContext must be an object')
  assertKnownKeys(value, DELEGATION_CONTEXT_KEYS, 'delegationContext')
  const depth = requiredInteger(value, 'depth', 0)
  const maxDepth = requiredInteger(value, 'maxDepth', 0)
  if (depth + 1 > maxDepth) {
    throw new Error('persisted subagent descriptor delegationContext depth exceeds maxDepth')
  }
  const cwd = optionalString(value, 'cwd')
  const provider = optionalString(value, 'provider')
  const model = optionalString(value, 'model')
  if (cwd === undefined || cwd.length === 0 || provider === undefined || provider.length === 0
    || model === undefined || model.length === 0) {
    throw new Error('persisted subagent descriptor delegationContext cwd, provider, and model must be nonempty strings')
  }
  const reasoningEffort = optionalString(value, 'reasoningEffort') as ReasoningEffortId | undefined
  const maxSteps = requiredInteger(value, 'maxSteps', 1)
  const maxTokens = Object.hasOwn(value, 'maxTokens') ? requiredInteger(value, 'maxTokens', 1) : undefined
  const toolNames = requiredNameList(value, 'toolNames')
  const builtinToolNames = requiredNameList(value, 'builtinToolNames')
  const programToolNames = requiredNameList(value, 'programToolNames')
  if (builtinToolNames.some(name => !toolNames.includes(name))) {
    throw new Error('persisted subagent descriptor delegationContext builtinToolNames must be in toolNames')
  }
  return { depth, maxDepth, cwd, provider, model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort }, maxSteps,
    ...maxTokens === undefined ? {} : { maxTokens }, toolNames, builtinToolNames, programToolNames }
}

/** Validate and reconstruct a persisted tool restriction. */
function parseToolFilter(value: unknown): ToolRestriction {
  if (!isRecord(value)) {
    throw new Error('persisted subagent descriptor toolFilter must be an object')
  }
  assertKnownKeys(value, TOOL_FILTER_KEYS, 'toolFilter')
  const allow = optionalStringArray(value, 'allow')
  const deny = optionalStringArray(value, 'deny')
  if (allow === undefined && deny === undefined) {
    throw new Error('persisted subagent descriptor toolFilter must declare allow and/or deny')
  }
  return {
    ...allow !== undefined ? { allow } : {},
    ...deny !== undefined ? { deny } : {},
  }
}

/** Validate one persisted descriptor payload for the current runtime. */
function parseSubagentDescriptor(value: unknown): SubagentDescriptorData | undefined {
  if (!isRecord(value)) {
    throw new Error('persisted subagent descriptor payload must be an object')
  }
  const version = value['version']
  if (typeof version !== 'number') {
    throw new Error('persisted subagent descriptor version must be a number')
  }
  if (version !== SUBAGENT_DESCRIPTOR_VERSION && version !== PREVIOUS_SUBAGENT_DESCRIPTOR_VERSION) return undefined

  const mode = value['mode']
  if (mode !== 'one-shot' && mode !== 'continuable') {
    throw new Error('persisted subagent descriptor mode must be "one-shot" or "continuable"')
  }
  assertKnownKeys(
    value,
    mode === 'one-shot' ? ONE_SHOT_DESCRIPTOR_KEYS
      : version === PREVIOUS_SUBAGENT_DESCRIPTOR_VERSION ? V3_CONTINUABLE_DESCRIPTOR_KEYS : CONTINUABLE_DESCRIPTOR_KEYS,
    'payload',
  )
  const provider = value['provider']
  if (typeof provider !== 'string') {
    throw new Error('persisted subagent descriptor provider must be a string')
  }
  if (mode === 'one-shot') {
    const label = optionalString(value, 'label')
    return {
      version,
      mode,
      provider,
      ...label !== undefined ? { label } : {},
    }
  }
  const label = value['label']
  if (typeof label !== 'string') {
    throw new Error('persisted subagent descriptor label must be a string')
  }
  const agentProvider = optionalString(value, 'agentProvider')
  const agentModel = optionalString(value, 'agentModel')
  const agentReasoningEffort = optionalString(value, 'agentReasoningEffort') as ReasoningEffortId | undefined
  const persona = optionalString(value, 'persona')
  const toolFilter = Object.hasOwn(value, 'toolFilter')
    ? parseToolFilter(value['toolFilter'])
    : undefined
  const delegationContext = version === SUBAGENT_DESCRIPTOR_VERSION && Object.hasOwn(value, 'delegationContext')
    ? parseDelegationContext(value['delegationContext'])
    : undefined
  return {
    version,
    mode,
    provider,
    label,
    ...agentProvider !== undefined ? { agentProvider } : {},
    ...agentModel !== undefined ? { agentModel } : {},
    ...agentReasoningEffort !== undefined ? { agentReasoningEffort } : {},
    ...persona !== undefined ? { persona } : {},
    ...toolFilter !== undefined ? { toolFilter } : {},
    ...delegationContext !== undefined ? { delegationContext } : {},
  }
}

/**
 * Validate and detach descriptor inputs into the durable payload, before any
 * Task or provider work begins — the same detached lossless-JSON boundary the
 * session log itself enforces, applied early so a synchronous validation
 * failure rejects the tool call without creating a Task.
 * @param input - the caller-collected composition fields.
 * @returns the versioned, detached descriptor payload.
 * @throws when a field is not losslessly JSON-serializable.
 */
export function snapshotSubagentDescriptor(
  input: OneShotSubagentDescriptorInput,
): OneShotSubagentDescriptorData
/**
 * Validate and detach a continuable descriptor input.
 * @param input - the caller-collected continuable composition fields.
 * @returns the versioned, detached continuable descriptor payload.
 * @throws when a field is not losslessly JSON-serializable.
 */
export function snapshotSubagentDescriptor(
  input: ContinuableSubagentDescriptorInput,
): ContinuableSubagentDescriptorData
export function snapshotSubagentDescriptor(input: SubagentDescriptorInput): SubagentDescriptorData {
  const candidate: SubagentDescriptorData = input.mode === 'one-shot'
    ? {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: input.mode,
      provider: input.provider,
      ...input.label !== undefined ? { label: input.label } : {},
    }
    : {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: input.mode,
      provider: input.provider,
      label: input.label,
      ...input.agentProvider !== undefined ? { agentProvider: input.agentProvider } : {},
      ...input.agentModel !== undefined ? { agentModel: input.agentModel } : {},
      ...input.agentReasoningEffort !== undefined ? { agentReasoningEffort: input.agentReasoningEffort } : {},
      ...input.persona !== undefined ? { persona: input.persona } : {},
      ...input.toolFilter !== undefined ? { toolFilter: input.toolFilter } : {},
      ...input.delegationContext !== undefined ? { delegationContext: parseDelegationContext(input.delegationContext) } : {},
    }
  const snapshot = snapshotJsonValue(candidate)
  if (snapshot === undefined) {
    throw new Error('subagent descriptor is not losslessly JSON-serializable')
  }
  return snapshot
}

/**
 * Fold a persisted child log to its supported descriptor. The first
 * `subagent/descriptor` event is authoritative — the establishing provider
 * appends exactly one, so a later same-type event cannot rewrite the declared
 * composition.
 * @param events - the loaded child session events.
 * @returns the descriptor, or `undefined` when the log has none or its
 *   version is unsupported by this runtime.
 * @throws when a supported-version persisted payload does not match its
 *   complete declared schema.
 */
export function foldSubagentDescriptor(events: readonly SessionEvent[]): SubagentDescriptorData | undefined {
  const event = events.find(
    (candidate): candidate is SessionEvent<'subagent/descriptor'> => candidate.type === 'subagent/descriptor',
  )
  if (event === undefined) return undefined
  return parseSubagentDescriptor(event.data)
}
