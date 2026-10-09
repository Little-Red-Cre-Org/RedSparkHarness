/** Public access to one selected Program's active Session and step admission. */
import { isDeepStrictEqual } from 'node:util'
import type {
  NativeActiveSessionOwner,
  NativeStepAdmissionContext,
  NativeStepAdmissionDecision,
  NativeStepAdmissionHook,
} from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'
export type * from '@deepseek-ai/dsh-native-session-execution/active-session-protocol'

interface HookEntry {
  readonly hook: NativeStepAdmissionHook
  readonly order: number
  readonly sequence: number
  readonly pending: Set<Promise<NativeStepAdmissionDecision>>
}

/** Per-owner ordered hooks; the selected Program alone persists claims and discarded inputs. */
export class NativeStepAdmission {
  private readonly hooks = new Set<HookEntry>()
  private readonly pending = new Set<Promise<NativeStepAdmissionDecision>>()
  private sequence = 0
  private closing = false
  private disposal: Promise<void> | undefined

  /**
   * Register one contribution and retain each accepted invocation until it settles.
   * @param hook - waterfall operation; returning without next() intentionally short-circuits.
   * @param order - finite ascending priority.
   * @returns exact removal and drain of accepted hook invocations.
   */
  register(hook: NativeStepAdmissionHook, order: number): () => Promise<void> {
    if (this.closing) throw new Error('native-step-admission: owner is closing')
    if (!Number.isFinite(order)) throw new Error('native-step-admission: order must be finite')
    const entry: HookEntry = { hook, order, sequence: this.sequence++, pending: new Set() }
    this.hooks.add(entry)
    let release: Promise<void> | undefined
    return () => {
      this.hooks.delete(entry)
      return release ??= this.drain([...entry.pending])
    }
  }

  /**
   * Resolve an unchanged candidate subset without claiming or writing any input.
   * @param context - captured input and exact owner supplied by the Program.
   * @returns validated decision after cancellation and owner-liveness checks.
   */
  async decide(context: NativeStepAdmissionContext): Promise<NativeStepAdmissionDecision> {
    this.assertAvailable(context.owner)
    context.signal.throwIfAborted()
    const captured = structuredClone(context.candidates)
    const entries = [...this.hooks].sort((left, right) => left.order - right.order || left.sequence - right.sequence)
    const invoke = (index: number): Promise<NativeStepAdmissionDecision> => {
      const entry = entries[index]
      if (entry === undefined) return Promise.resolve({ kind: 'enter', messages: structuredClone(captured) })
      if (!this.hooks.has(entry)) return invoke(index + 1)
      let delegated = false
      const operation = Promise.resolve().then(() => entry.hook({ ...context, candidates: structuredClone(captured) }, () => {
        if (delegated) throw new Error('native-step-admission: next called more than once')
        delegated = true
        return invoke(index + 1)
      }))
      entry.pending.add(operation)
      this.pending.add(operation)
      const settled = (): void => { entry.pending.delete(operation); this.pending.delete(operation) }
      void operation.then(settled, settled)
      return operation
    }
    const decision = await invoke(0)
    context.signal.throwIfAborted()
    this.assertAvailable(context.owner)
    const selected = decision.kind === 'enter' ? decision.messages.map(message => message.id) : decision.discard
    if (new Set(selected).size !== selected.length || selected.some(id => !captured.some(message => message.id === id))) {
      throw new Error('native-step-admission: decision must select unique captured input ids')
    }
    if (decision.kind === 'enter' && decision.messages.some(message => !isDeepStrictEqual(
      captured.find(candidate => candidate.id === message.id), message))) {
      throw new Error('native-step-admission: admitted messages must preserve durable input')
    }
    return structuredClone(decision)
  }

  /**
 * Close admission and await all accepted hooks.
 * @returns the memoized drain promise.
 */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closing = true
    const pending = [...this.pending]
    this.hooks.clear()
    return this.disposal = this.drain(pending)
  }

  private assertAvailable(owner: NativeActiveSessionOwner): void {
    if (this.closing || !owner.writerAvailable) throw new Error('native-step-admission: owner is closing')
  }

  private async drain(pending: readonly Promise<NativeStepAdmissionDecision>[]): Promise<void> {
    await Promise.allSettled(pending)
  }
}
