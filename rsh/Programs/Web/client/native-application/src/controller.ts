/** Native conversation view state; Session execution and persistence remain on the Host. */
import type { NativeSessionClient, NativeSessionFollowFrame, NativeSessionListItem } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeImageUpload, NativeSessionImage } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeWebHumanPrompt, NativeWebHumanAnswer } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeModelControls } from '@deepseek-ai/dsh-client-native-session/native'
import { foldNativeModelSelectionState, type ModelSelection } from '@deepseek-ai/dsh-native-model-selection/types'
import { foldNativeAgentPresetFacts } from '@deepseek-ai/dsh-agent-presets/selection'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'

/** Settled durable history and the Client's outstanding operation. */
export interface ConversationSnapshot {
  readonly header?: SessionHeader | undefined
  readonly modelControls?: NativeModelControls | undefined
  readonly human?: NativeWebHumanPrompt | undefined
  readonly answeringHuman?: boolean | undefined
  readonly sessions: readonly NativeSessionListItem[]
  readonly selected?: SessionId
  readonly events: readonly SessionEvent[]
  readonly liveText?: string | undefined
  readonly liveTruncated?: boolean | undefined
  readonly state: 'loading' | 'ready' | 'sending' | 'cancelling' | 'closed'
  readonly error?: string | undefined
}

/** Explicit retained presentation limits, supplied by the Client profile. */
export interface NativeConversationLimits {
  readonly maxLiveTextChars: number
  readonly maxLiveEvents: number
}

/** Own one interactive Session selection and await all requests before disposal. */
export class NativeConversationController {
  private snapshot: ConversationSnapshot = { sessions: [], events: [], state: 'loading' }
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<void>>()
  private readonly background = new Set<Promise<void>>()
  private rosterRevision = 0
  private turn: AbortController | undefined
  private foregroundAdmission: { readonly sessionId: SessionId } | undefined
  private followErrorOwner: { readonly sessionId: SessionId } | undefined
  private closing: Promise<void> | undefined

  /**
   * @param client - selected Host Session Consumer; this controller does not close the shared Provider.
   * @param limits - maximum retained live presentation.
   */
  constructor(private readonly client: NativeSessionClient, private readonly limits: NativeConversationLimits) {}

  /** Read the current conversation view.
   * @returns immutable view snapshot, stable until an operation publishes a change. */
  readonly getSnapshot = (): ConversationSnapshot => this.snapshot

  /** Observe view changes.
   * @param listener - render notification.
   * @returns exact notification removal.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(change: Partial<ConversationSnapshot>): void {
    if (this.lifetime.signal.aborted) return
    this.snapshot = Object.freeze({ ...this.snapshot, ...change })
    for (const listener of [...this.listeners]) {
      try { listener() } catch (error: unknown) { console.error('native conversation subscriber failed:', error) }
    }
  }

  private run(operation: () => Promise<void>): Promise<void> {
    this.lifetime.signal.throwIfAborted()
    const pending = operation().catch((error: unknown) => {
      this.publish({ error: error instanceof Error ? error.message : String(error) })
    }).finally(() => {
      this.pending.delete(pending)
      this.publish({ state: 'ready' })
    })
    this.pending.add(pending)
    return pending
  }

  private assertReady(): void {
    if (this.snapshot.state !== 'ready') throw new Error('native conversation: operation already pending')
  }

  private async restore(id: SessionId): Promise<void> {
    const history = await this.client.history(id, this.lifetime.signal)
    this.publish({ selected: id, header: history.header, events: history.events })
  }

  private async reload(id?: SessionId): Promise<void> {
    const revision = ++this.rosterRevision
    const sessions = await this.client.list(this.lifetime.signal)
    if (revision !== this.rosterRevision || this.lifetime.signal.aborted) return
    this.publish({ sessions })
    if (id !== undefined && this.snapshot.selected === id) await this.restore(id)
  }

  private refreshRoster(): void {
    if (this.lifetime.signal.aborted) return
    const work = this.reload().catch((error: unknown) => {
      this.publish({ error: error instanceof Error ? error.message : String(error) })
    }).finally(() => { this.background.delete(work) })
    this.background.add(work)
  }

  /** Read the persisted index without automatically resuming a Session.
   * @returns completion after the initial index request.
   */
  load(): Promise<void> {
    return this.run(async () => {
      const revision = ++this.rosterRevision
      const [sessions, modelControls] = await Promise.all([
        this.client.list(this.lifetime.signal), this.client.modelControls(this.lifetime.signal),
      ])
      if (revision === this.rosterRevision) this.publish({ sessions, modelControls, error: undefined })
    })
  }

  /** Create and select a durably stored blank Session.
   * @returns completion after its header and history are available.
   */
  create(): Promise<void> {
    this.assertReady()
    this.followErrorOwner = undefined
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      const { sessionId } = await this.client.create(this.lifetime.signal)
      await this.restore(sessionId)
      await this.reload()
    })
  }

  /** Select a stored Session and reconstruct its durable transcript.
   * @param id - identity from the Host's index.
   * @returns history completion; selection does not execute a turn.
   */
  select(id: SessionId): Promise<void> {
    this.assertReady()
    this.followErrorOwner = undefined
    this.publish({ state: 'loading', error: undefined })
    return this.run(() => this.restore(id))
  }

  /** Pin an edited title through the selected Host's existing Session writer.
   * @param id - ID of the Session whose title to rename.
   * @param title - New title to persist.
   */
  renameTitle(id: SessionId, title: string): Promise<void> {
    this.assertReady()
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      await this.client.renameTitle(id, title, this.lifetime.signal)
      await this.reload(id)
    })
  }

  /** Explicitly refresh the selected Host title provider or deterministic fallback.
   * @param id - ID of the Session whose title to refresh.
   */
  refreshTitle(id: SessionId): Promise<void> {
    this.assertReady()
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      await this.client.refreshTitle(id, this.lifetime.signal)
      await this.reload(id)
    })
  }

  /** Refresh provider-owned menus without changing Session intent.
   * @returns completion after the current Host catalog and standing roster reply.
   */
  refreshModelControls(): Promise<void> {
    this.assertReady()
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => { this.publish({ modelControls: await this.client.modelControls(this.lifetime.signal) }) })
  }

  /** Persist a complete model and optional effort against the displayed intent revision.
   * @param selected - provider-owned route and explicit effort, if chosen.
   * @returns completion after durable selection and history refresh, including stale conflicts.
   */
  selectModel(selected: ModelSelection): Promise<void> {
    this.assertReady()
    const id = this.snapshot.selected
    if (id === undefined) throw new Error('native conversation: select a Session')
    const { revision } = foldNativeModelSelectionState(this.snapshot.events)
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      try { await this.client.selectModel(id, { selected, expectedRevision: revision }, this.lifetime.signal) }
      finally { if (!this.lifetime.signal.aborted) await this.restore(id) }
    })
  }

  /** Select a registered composition before the first turn locks the root epoch.
   * @param preset - identifier advertised by the Host's standing registry.
   * @returns completion after Program-owned Agent replacement and durable history refresh.
   */
  selectPreset(preset: string): Promise<void> {
    this.assertReady()
    const id = this.snapshot.selected
    const header = this.snapshot.header
    if (id === undefined || header === undefined) throw new Error('native conversation: select a Session')
    const { revision, locked } = foldNativeAgentPresetFacts(header, this.snapshot.events)
    if (locked) throw new Error('native conversation: preset is locked by the first turn')
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      try { await this.client.selectPreset({ id, preset, expectedRevision: revision }, this.lifetime.signal) }
      finally { if (!this.lifetime.signal.aborted) await this.restore(id) }
    })
  }

  /** Fetch a recorded image without changing execution readiness.
   * @param sessionId - owning displayed Session.
   * @param image - recorded reference.
   * @param signal - render lifetime cancellation.
   * @returns verified image Blob.
   */
  image(sessionId: SessionId, image: NativeSessionImage, signal: AbortSignal): Promise<Blob> {
    return this.client.image(sessionId, image, AbortSignal.any([signal, this.lifetime.signal]))
  }

  /** Send human text through the Host's sole turn executor.
   * @param text - nonempty submitted text.
   * @param files - browser-selected raster files; Provider limits govern admission.
   * @returns completion after Host settlement and durable transcript refresh.
   */
  send(text: string, files: readonly File[] = []): Promise<void> {
    this.assertReady()
    const id = this.snapshot.selected
    if (id === undefined || text.trim().length === 0) throw new Error('native conversation: select a Session and enter text')
    const turn = new AbortController()
    const signal = AbortSignal.any([turn.signal, this.lifetime.signal])
    const admission = { sessionId: id }
    this.foregroundAdmission = admission
    this.followErrorOwner = admission
    this.turn = turn
    this.publish({ state: 'sending', error: undefined, liveText: undefined, liveTruncated: false })
    return this.run(async () => {
      let turnFailed = false
      try {
        const images: NativeImageUpload[] = []
        const policy = this.snapshot.modelControls?.images
        if (files.length > 0) {
          if (policy === undefined || files.length > policy.maxImagesPerMessage
            || files.reduce((sum, file) => sum + file.size, 0) > policy.maxMessageImageBytes) throw new Error('native conversation: image batch exceeds configured limits or is unavailable')
          for (const file of files) {
            const mediaType = policy.mediaTypes.find(type => type === file.type)
            if (mediaType === undefined || file.size > policy.maxImageBytes) throw new Error('native conversation: image type or size is refused')
            const data = await new Promise<string | undefined>((resolve, reject) => {
              const reader = new FileReader()
              const abort = (): void => { cleanup(); reader.abort(); resolve(undefined) }
              const cleanup = (): void => {
                signal.removeEventListener('abort', abort)
                reader.onload = reader.onerror = reader.onabort = null
              }
              reader.onload = () => {
                cleanup()
                const dataUrl = reader.result as string
                resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
              }
              reader.onerror = () => { cleanup(); reject(new Error('native conversation: image read failed', { cause: reader.error })) }
              reader.onabort = (): void => { cleanup(); resolve(undefined) }
              signal.addEventListener('abort', abort, { once: true })
              if (signal.aborted) abort()
              else reader.readAsDataURL(file)
            })
            if (data === undefined) return
            images.push({ mediaType, data, name: file.name })
          }
        }
        const result = await this.client.prompt(id, text, true, signal,
          (frame) => { this.observe(frame, admission) }, images,
          (error) => {
            if (this.followErrorOwner === admission && this.snapshot.selected === id && !this.lifetime.signal.aborted) {
              this.publish({ error: error instanceof Error ? error.message : String(error) })
            }
          })
        if (result.exitCode !== 0 && result.exitCode !== 130) {
          throw new Error(`native conversation: turn exited with code ${result.exitCode}`)
        }
      } catch (error: unknown) {
        turnFailed = true
        throw error
      } finally {
        if (this.foregroundAdmission === admission) this.foregroundAdmission = undefined
        this.turn = undefined
        this.publish({ liveText: undefined, liveTruncated: false, human: undefined, answeringHuman: false })
        if (!this.lifetime.signal.aborted && this.snapshot.selected === id) {
          try { await this.reload(id) }
          catch (error: unknown) { if (!turnFailed) throw error }
        }
      }
    })
  }

  private observe(frame: NativeSessionFollowFrame, admission: { readonly sessionId: SessionId }): void {
    if (frame.type === 'title-updated') {
      this.refreshRoster()
      return
    }
    if (this.foregroundAdmission !== admission || this.snapshot.selected !== admission.sessionId) return
    if (frame.type === 'human') this.publish({ human: frame.prompt, answeringHuman: false })
    else if (frame.type === 'human-removed') { if (this.snapshot.human?.id === frame.id) this.publish({ human: undefined, answeringHuman: false }) }
    else if (frame.type === 'event') {
      const last = this.snapshot.events.at(-1)?.seq
      if (last !== undefined && frame.event.seq <= last) return
      if (last !== undefined && frame.event.seq !== last + 1) throw new Error('native conversation: live history sequence gap')
      if (this.snapshot.events.length >= this.limits.maxLiveEvents) throw new Error('native conversation: live history exceeds configured limit')
      this.publish({ events: [...this.snapshot.events, frame.event],
        ...frame.event.type === 'assistant/message' || frame.event.type === 'assistant/attempt' ? { liveText: undefined, liveTruncated: false } : {} })
    } else if (frame.type === 'text-start') {
      this.publish({ liveText: '', liveTruncated: false })
    } else if (frame.type === 'text') {
      const text = (this.snapshot.liveText ?? '') + frame.text
      this.publish({ liveText: text.slice(-this.limits.maxLiveTextChars),
        liveTruncated: this.snapshot.liveTruncated === true || text.length > this.limits.maxLiveTextChars })
    }
  }

  /** Answer only the presentation the renderer observed, without changing turn readiness.
   * @param prompt - exact displayed presentation.
   * @param answer - human's structured choice.
   * @returns acknowledgement; failures retain the request for correction.
   */
  answerHuman(prompt: NativeWebHumanPrompt, answer: NativeWebHumanAnswer): Promise<void> {
    const id = this.snapshot.selected
    if (id === undefined || this.snapshot.human !== prompt || this.snapshot.answeringHuman || this.snapshot.state !== 'sending') throw new Error('native conversation: no matching unanswered presentation')
    this.publish({ answeringHuman: true, error: undefined })
    const work = this.client.answerHuman(id, prompt.id, answer, this.lifetime.signal).catch((error: unknown) => {
      this.publish({ error: error instanceof Error ? error.message : String(error) })
    }).finally(() => { this.pending.delete(work); this.publish({ answeringHuman: false }) })
    this.pending.add(work)
    return work
  }

  /** Request cancellation; readiness is published only by the settled send operation. */
  cancel(): void {
    if (this.turn === undefined) return
    this.publish({ state: 'cancelling' })
    this.turn.abort(new Error('native conversation: user cancelled'))
  }

  /** Cancel owned calls and await the Client's durable prompt settlement.
   * @returns memoized disposal completion.
   */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.lifetime.abort(new Error('native conversation: disposed'))
    this.followErrorOwner = undefined
    this.snapshot = Object.freeze({ ...this.snapshot, state: 'closed' })
    this.listeners.clear()
    return this.closing = (async () => {
      while (this.pending.size > 0 || this.background.size > 0) {
        await Promise.allSettled([...this.pending, ...this.background])
      }
    })()
  }
}
