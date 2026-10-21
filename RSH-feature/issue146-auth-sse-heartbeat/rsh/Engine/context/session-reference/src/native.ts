/** Cordis-free Native preparation for durable cross-session snapshots. */

import type { NativePlugin } from '@deepseek-ai/dsh-native-runtime'
import type { Session } from '@deepseek-ai/dsh-session/native'
import type { NativeSessionQueryOperations } from '@deepseek-ai/dsh-session-query/native'
import type { SpillOperations } from '@deepseek-ai/dsh-spill/native'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import { DEFAULT_MAX_REFERENCE_BYTES, MAX_REFERENCES, SessionReferenceError } from './config.ts'
import { prepareReferenceInput, prepareReferencedMessage, settleAll } from './prepared-context.ts'
import { parseSessionReferenceText } from './uri.ts'

/** Native read-only context preparation over the exact session query owner. */
export interface NativeSessionReferenceOperations {
  /**
   * Prepare durable untrusted contexts for newly admitted user messages without rewriting inputs.
   * The caller appends them through its existing Session writer; cancellation or failure waits for
   * started reads and spills to settle before preparation rejects.
   */
  prepare(session: Session, inputs: readonly UserMessage[], signal: AbortSignal): Promise<readonly UserMessage[]>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices { sessionReference: NativeSessionReferenceOperations }
}

interface NativeConfig {
  maxReferences: number
  maxReferenceBytes: number
}

class NativeSessionReference implements NativeSessionReferenceOperations {
  constructor(
    private readonly query: NativeSessionQueryOperations,
    private readonly spill: SpillOperations | undefined,
    private readonly config: NativeConfig,
    private readonly lifetime: AbortSignal,
  ) {}

  /** @inheritdoc */
  async prepare(session: Session, inputs: readonly UserMessage[], signal: AbortSignal): Promise<readonly UserMessage[]> {
    const effective = AbortSignal.any([signal, this.lifetime])
    const spill = this.spill
    const spillStore = spill === undefined ? undefined : {
      saveText: (input: Parameters<SpillOperations['saveText']>[0]) => spill.saveText(input, effective),
    }
    const contexts = await settleAll(inputs.map(async (message) => {
      if (message.source.kind !== 'user') return undefined
      const references = message.content.flatMap(block => block.type === 'text'
        ? parseSessionReferenceText(block.text).references : [])
      if (references.length === 0) return undefined
      const preparedInput = prepareReferenceInput(session.id, message.content, references, this.config.maxReferences, effective)
      const prepared = await prepareReferencedMessage({
        reader: this.query,
        ...(spillStore === undefined ? {} : { spillStore }),
        ownerId: session.id,
        ...preparedInput,
        maxReferenceBytes: this.config.maxReferenceBytes,
        signal: effective,
      })
      effective.throwIfAborted()
      return prepared.additionalContext
    }), effective)
    effective.throwIfAborted()
    return contexts.filter((message): message is UserMessage => message !== undefined)
  }
}

function nativeConfig(input: unknown): NativeConfig {
  const value = input === undefined ? {} : input
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionReferenceError('session-reference: native configuration must be an object', 'SESSION_REFERENCE_INVALID_CONFIG')
  }
  const config = value as Record<string, unknown>
  const maxReferences = config.maxReferences === undefined ? MAX_REFERENCES : config.maxReferences
  const maxReferenceBytes = config.maxReferenceBytes === undefined ? DEFAULT_MAX_REFERENCE_BYTES : config.maxReferenceBytes
  if (!Number.isSafeInteger(maxReferences) || (maxReferences as number) < 1 || (maxReferences as number) > MAX_REFERENCES) {
    throw new SessionReferenceError(`session-reference: maxReferences must be between 1 and ${MAX_REFERENCES}`, 'SESSION_REFERENCE_INVALID_CONFIG')
  }
  if (!Number.isSafeInteger(maxReferenceBytes) || (maxReferenceBytes as number) <= 0) {
    throw new SessionReferenceError('session-reference: maxReferenceBytes must be a positive safe integer', 'SESSION_REFERENCE_INVALID_CONFIG')
  }
  if (Object.keys(config).some(key => key !== 'maxReferences' && key !== 'maxReferenceBytes')) {
    throw new SessionReferenceError('session-reference: unknown Native configuration field', 'SESSION_REFERENCE_INVALID_CONFIG')
  }
  return { maxReferences: maxReferences as number, maxReferenceBytes: maxReferenceBytes as number }
}

/** Stateless Native session-reference Provider over the selected query and spill services. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-session-reference',
  targets: ['host'],
  requires: ['sessionQuery'],
  optional: ['spillStore'],
  provides: ['sessionReference'],
  resolve(input) {
    const config = nativeConfig(input)
    return (context) => {
      context.provide('sessionReference', new NativeSessionReference(
        context.require('sessionQuery'), context.optional('spillStore'), config, context.signal,
      ))
    }
  },
}
