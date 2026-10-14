/** Native message-feedback Provider backed by the selected Session writer or cold write lease. */
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { deriveEventMessage, isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence/native'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { NativePlugin, NativeScope } from '@deepseek-ai/dsh-native-runtime'
import type { NativeActiveSessionOperations, NativeActiveSessionOwner } from '@deepseek-ai/dsh-native-session-execution'
import type { NativeSessionPersistenceOperations, SessionInspection } from '@deepseek-ai/dsh-session-persistence/native'
import type { NativeFeedbackCommit } from '@deepseek-ai/dsh-command-feedback/native-definition'
import type { NativeMessageFeedbackOperations } from './native-definition.ts'
import type {
  MessageFeedbackDeleteRequest, MessageFeedbackDeleteResult,
  MessageFeedbackItem, MessageFeedbackListRequest, MessageFeedbackListResult,
  MessageFeedbackPutRequest, MessageFeedbackPutResult, MessageFeedbackVersion,
} from './types.ts'
import { currentItems, rejected, resolveNote, snapshotItem, success, versionConflict,
  type Append, type FeedbackEvent, type MissingSession } from './shared.ts'
import type {} from '@deepseek-ai/dsh-command-feedback/native-definition'
import type {} from '@deepseek-ai/dsh-session/native'

interface NativeConfig { readonly maxNoteBytes: number }
type Operation<T> = (events: readonly SessionEvent[], append: Append) => T | Promise<T>

function parseConfig(input: unknown): NativeConfig {
  return z.strictObject({ maxNoteBytes: z.number().int().min(1).refine(Number.isSafeInteger) }).parse(input)
}

/** Native Provider for canonical per-message feedback. */
export const plugin: NativePlugin = {
  apiVersion: 1,
  name: '@deepseek-ai/dsh-message-feedback',
  targets: ['host'],
  requires: ['sessionPersistence', 'activeSessions'],
  provides: ['messageFeedback'],
  resolve(input) {
    const config = parseConfig(input)
    return (context) => {
      const service = new NativeMessageFeedback(context.require('sessionPersistence'), context.require('activeSessions'),
        context.signal, context.scope, config.maxNoteBytes, commit => context.events.parallel(
          commit.scope, 'feedback/committed', commit))
      context.provide('messageFeedback', service)
      context.own(() => service.close())
    }
  },
}

class NativeMessageFeedback implements NativeMessageFeedbackOperations {
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly liveOperations = new Map<NativeActiveSessionOwner, Set<Promise<unknown>>>()
  private readonly removeDetached: () => Promise<void>
  private accepting = true

  constructor(private readonly persistence: NativeSessionPersistenceOperations,
    private readonly active: NativeActiveSessionOperations, private readonly signal: AbortSignal, private readonly scope: NativeScope,
    private readonly maxNoteBytes: number,
    private readonly committed: (commit: NativeFeedbackCommit) => Promise<void>) {
    this.removeDetached = active.onDetached(owner => this.drainLiveOperations(owner))
  }

  list(request: MessageFeedbackListRequest, signal?: AbortSignal): Promise<MessageFeedbackListResult> {
    return this.enqueue(request.sessionId, () => this.withSession(request.sessionId, false, events =>
      success(Object.freeze({ items: Object.freeze(currentItems(request.sessionId, events).map(snapshotItem)) })), signal))
  }

  put(request: MessageFeedbackPutRequest, signal?: AbortSignal): Promise<MessageFeedbackPutResult> {
    const note = resolveNote(request.note, this.maxNoteBytes)
    if (!note.ok) return Promise.resolve(note)
    return this.enqueue(request.sessionId, () => this.withSession(request.sessionId, true, async (events, append) => {
      const items = currentItems(request.sessionId, events)
      if (!events.some(event => event.type === 'assistant/message' && isAppendSurfaceEvent(event)
        && deriveEventMessage(event)?.id === request.messageId)) {
        return rejected({ code: 'target-not-found', sessionId: request.sessionId, messageId: request.messageId })
      }
      const existing = items.find(item => item.messageId === request.messageId)
      if (request.ifVersion !== (existing?.version ?? null)) return rejected(versionConflict(existing ?? null))
      if (existing !== undefined && existing.rating === request.rating && existing.note === note.value
        && existing.category === request.category) {
        await append()
        return success(snapshotItem(existing))
      }
      const now = Date.now()
      const item: MessageFeedbackItem = {
        messageId: request.messageId, rating: request.rating,
        ...(note.value === undefined ? {} : { note: note.value }),
        ...(request.category === undefined ? {} : { category: request.category }),
        version: randomUUID() as MessageFeedbackVersion,
        createdAt: existing?.createdAt ?? now, updatedAt: existing === undefined ? now : Math.max(now, existing.updatedAt),
      }
      await append({ type: 'feedback/message-put', data: { sessionId: request.sessionId, item } })
      return success(snapshotItem(item))
    }, signal))
  }

  delete(request: MessageFeedbackDeleteRequest, signal?: AbortSignal): Promise<MessageFeedbackDeleteResult> {
    return this.enqueue(request.sessionId, () => this.withSession(request.sessionId, true, async (events, append) => {
      const existing = currentItems(request.sessionId, events).find(item => item.messageId === request.messageId)
      if (existing !== undefined) {
        if (request.ifVersion !== existing.version) return rejected(versionConflict(existing))
        await append({ type: 'feedback/message-delete', data: { sessionId: request.sessionId, messageId: request.messageId } })
      } else await append()
      return success(Object.freeze({ absent: true as const }))
    }, signal))
  }

  async close(): Promise<void> {
    this.accepting = false
    await Promise.all(this.tails.values())
    await this.removeDetached()
  }

  private async withSession<T>(
    sessionId: SessionId, write: boolean, operation: Operation<T>, signal?: AbortSignal,
  ): Promise<T | MissingSession> {
    this.signal.throwIfAborted()
    signal?.throwIfAborted()
    const live = this.liveOwner(sessionId)
    if (live !== undefined) {
      return this.trackLiveOperation(live, async () => {
        const events = await live.readEvents(signal === undefined ? undefined : { signal })
        return operation(events, async (mutation) => {
          signal?.throwIfAborted()
          const committed = mutation === undefined ? undefined : live.append(mutation.type, mutation.data)
          await live.flush()
          if (committed !== undefined) {
            const durable = await live.readCommittedEvents(committed.seq + 1)
            if (!isDeepStrictEqual(durable[committed.seq], committed)) {
              throw new Error(`message-feedback: feedback prefix is not durable for live Session '${sessionId}'`)
            }
            await this.notify({ owner: live, scope: live.agent.scope,
              inspection: { meta: live.session.header, inheritedEventCount: SessionLogOffset(live.inheritedEventCount), events: durable } })
          }
        })
      })
    }
    if (await this.persistence.stat(sessionId, signal === undefined ? undefined : { signal }) === undefined) {
      const attached = this.liveOwner(sessionId)
      if (attached !== undefined) return this.withSession(sessionId, write, operation, signal)
      return rejected({ code: 'session-not-found', sessionId })
    }
    let handle
    try { handle = await this.persistence.open(sessionId, write ? 'write' : 'read', signal === undefined ? undefined : { signal }) }
    catch (error: unknown) {
      if (error instanceof SessionPersistenceNotFoundError) return rejected({ code: 'session-not-found', sessionId })
      throw error
    }
    try {
      const { events } = await handle.read(SessionLogOffset(0), undefined, signal === undefined ? undefined : { signal })
      return await operation(events, async (mutation) => {
        signal?.throwIfAborted()
        const entry: FeedbackEvent | undefined = mutation === undefined ? undefined
          : { ...mutation, seq: SessionSeq(events.length), time: Date.now() }
        if (entry !== undefined) await handle.append([entry], signal === undefined ? undefined : { signal })
        await handle.flush()
        if (entry !== undefined) {
          const { events: durable } = await handle.read()
          if (!isDeepStrictEqual(durable[entry.seq], entry)) {
            throw new Error(`message-feedback: feedback prefix is not durable for cold Session '${sessionId}'`)
          }
          const inspection: SessionInspection = { meta: handle.header, inheritedEventCount: handle.inheritedEventCount, events: durable }
          await this.notify({ scope: this.scope, inspection })
        }
      })
    } finally { await handle.close() }
  }

  private liveOwner(sessionId: SessionId): NativeActiveSessionOwner | undefined {
    return this.active.owners().find(owner => owner.session.id === sessionId && owner.writerAvailable)
  }

  private trackLiveOperation<T>(owner: NativeActiveSessionOwner, operation: () => Promise<T>): Promise<T> {
    const pending = this.liveOperations.get(owner) ?? new Set<Promise<unknown>>()
    const result = Promise.resolve().then(operation)
    pending.add(result)
    this.liveOperations.set(owner, pending)
    const settled = (): void => {
      pending.delete(result)
      if (pending.size === 0) this.liveOperations.delete(owner)
    }
    void result.then(settled, settled)
    return result
  }

  private async drainLiveOperations(owner: NativeActiveSessionOwner): Promise<void> {
    const pending = this.liveOperations.get(owner)
    if (pending !== undefined) await Promise.all(pending)
  }

  private async notify(commit: NativeFeedbackCommit): Promise<void> {
    try { await this.committed(commit) }
    catch (error) { console.warn('message-feedback: committed feedback observer failed', error) }
  }

  private enqueue<T>(sessionId: SessionId, operation: () => Promise<T>): Promise<T> {
    if (!this.accepting || this.signal.aborted) return Promise.reject(new Error('message-feedback: service is disposing'))
    const previous = this.tails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(sessionId, tail)
    return result.finally(() => { if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId) })
  }
}
