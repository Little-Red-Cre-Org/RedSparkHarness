/**
 * Native default model selection for Agents created without a session choice.
 *
 * The Cordis owner (`@redspark/rsh-agent-default-model`) is a service the agent
 * loop reads before each root step. This Provider publishes the same policy on
 * the Native side: a composed deployment default, optionally overridden by a
 * stored settings section, exposed as the `agentDefaultModel` service and as the
 * live callback `native-headless` consults for a root fallback.
 *
 * @module @redspark/rsh-agent-default-model/native
 */

import { z } from 'zod'
import schemastery from '@redspark/schemastery'
import { ReasoningEffortId } from '@redspark/rsh-llm/native'
import type {
  NativeAgentDefaultModelOperations,
  NativeBrandedModelSelection,
  NativeModelSelection,
  NativePlugin,
} from './native-definition.ts'
import type {} from './native-definition.ts'

export type {
  NativeAgentDefaultModelOperations,
  NativeBrandedModelSelection,
  NativeModelSelection,
} from './native-definition.ts'

/** Settings namespace carrying the default model selection for future Agents. */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'

/** Stored settings section: the same fields the Cordis owner persists. */
const settingsSectionSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
})

/**
 * The schema the Native Settings page edits.
 *
 * A namespace registered without a schema is reachable by the settings document
 * but invisible to the page, so the provider always publishes one.
 */
const MODEL_SELECTION_SCHEMA = schemastery.object({
  provider: schemastery.string().default(''),
  model: schemastery.string().default(''),
  reasoningEffort: schemastery.string(),
})

/** Provider configuration: the composition default. */
export interface Config {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Adapter-owned reasoning effort for the composed default. */
  readonly reasoningEffort?: string
}

/**
 * Validate the composed default before the Provider activates.
 * @param input - profile configuration value.
 * @returns the immutable composed selection.
 */
export function resolveConfig(input: unknown): NativeModelSelection {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('agent-default-model: configuration must be an object')
  }
  const fields = input as Record<string, unknown>
  for (const key of Object.keys(fields)) {
    if (key !== 'provider' && key !== 'model' && key !== 'reasoningEffort') {
      throw new Error(`agent-default-model: unsupported configuration field ${key}`)
    }
  }
  const parsed = settingsSectionSchema.parse({
    provider: fields.provider,
    model: fields.model,
    ...fields.reasoningEffort === undefined ? {} : { reasoningEffort: fields.reasoningEffort },
  })
  return Object.freeze({
    provider: parsed.provider,
    model: parsed.model,
    ...parsed.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.reasoningEffort },
  })
}

/**
 * Read a written settings section into a selection.
 * @param value - the merged section as stored.
 * @returns the resolved selection; the registration base supplies omitted defaults.
 */
function resolveSettings(value: Record<string, unknown>): NativeModelSelection {
  const parsed = settingsSectionSchema.parse(value)
  return {
    provider: parsed.provider,
    model: parsed.model,
    ...parsed.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.reasoningEffort },
  }
}

/**
 * The Native default model policy.
 *
 * A stored settings section outranks the composed entry, so an operator changing
 * the default in the Native Settings page reaches the next Agent without a
 * restart. A deployment with no settings Provider keeps its composed entry.
 */
export class NativeAgentDefaultModel implements NativeAgentDefaultModelOperations {
  private current: NativeModelSelection

  /**
   * @param entry - the composed deployment default.
   */
  constructor(entry: NativeModelSelection) {
    this.current = entry
  }

  /**
   * Read the current default model selection.
   * @returns a detached selection with the optional reasoning effort.
   */
  currentSelection(): NativeBrandedModelSelection {
    const { reasoningEffort, ...route } = this.current
    return { ...route, ...reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(reasoningEffort) } }
  }

  /**
   * Accept a written settings section as the new effective default.
   * @param next - section read from the settings authority.
   */
  adopt(next: NativeModelSelection): void {
    this.current = next
  }
}

/** Default-model Provider selected explicitly by a Native profile. */
export const plugin: NativePlugin = {
  apiVersion: 1, name: '@redspark/rsh-agent-default-model', targets: ['host'],
  requires: [], optional: ['settings'], provides: ['agentDefaultModel'],
  resolve(input) {
    const entry = resolveConfig(input)
    return (context) => {
      const policy = new NativeAgentDefaultModel(entry)
      const settings = context.optional('settings')
      const scope = settings?.register(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, { ...entry }, resolveSettings,
        undefined, { schema: MODEL_SELECTION_SCHEMA, applies: 'live' })
      if (scope !== undefined) {
        // The stored section outranks the composed entry from the first step, and a
        // committed change reaches the next Agent without a restart.
        policy.adopt(scope.get())
        context.own(scope.watch((next) => { policy.adopt(next) }))
        context.own(() => { scope.dispose() })
      }
      context.provide('agentDefaultModel', policy)
    }
  },
}
