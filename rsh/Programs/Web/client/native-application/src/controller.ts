/** Native conversation view state; Session execution and persistence remain on the Host. */
import type {
  NativeSessionClient, NativeSessionFollowFrame, NativeSessionListFrame, NativeSessionListItem,
} from '@deepseek-ai/dsh-client-native-session/native'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { nativeSubmissionRequestId } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeSubmissionsSnapshot, NativeSubmissionRequestId, NativeSubmissionAcknowledgement } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeImageUpload, NativeSessionImage, NativeSessionInputPart } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeWebHumanPrompt, NativeWebHumanAnswer } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeModelControls } from '@deepseek-ai/dsh-client-native-session/native'
import type { NativeModeControls, NativePermissionControls } from '@deepseek-ai/dsh-client-native-session/native'
import { foldNativeModelSelectionState, type ModelSelection } from '@deepseek-ai/dsh-native-model-selection/types'
import { SessionSeq, type SessionEvent, type SessionHeader, type SessionId } from '@deepseek-ai/dsh-session/types'

/** Settled durable history and the Client's outstanding operation. */
export interface ConversationSnapshot {
  readonly header?: SessionHeader | undefined
  readonly modelControls?: NativeModelControls | undefined
  /** Host-owned choices for this Session's agent mode and plan mode. */
  readonly modeControls?: NativeModeControls | undefined
  /** Host-owned current permission policy and choices for this Session. */
  readonly permissionControls?: NativePermissionControls | undefined
  readonly submissions?: NativeSubmissionsSnapshot | undefined
  readonly submissionBusy?: boolean | undefined
  readonly submissionError?: string | undefined
  readonly human?: NativeWebHumanPrompt | undefined
  readonly answeringHuman?: boolean | undefined
  readonly sessions: readonly NativeSessionListItem[]
  readonly selected?: SessionId | undefined
  /** Whether a pending navigation blocks composer submissions. */
  readonly navigationPending?: boolean | undefined
  readonly events: readonly SessionEvent[]
  readonly liveText?: string | undefined
  readonly liveTruncated?: boolean | undefined
  readonly state: 'loading' | 'ready' | 'sending' | 'cancelling' | 'closed'
  readonly error?: string | undefined
}

/** Draft text and image files retained for one selected Session. */
export interface NativeConversationDraft {
  readonly text: string
  readonly files: readonly File[]
}

/** Explicit retained presentation limits, supplied by the Client profile. */
export interface NativeConversationLimits {
  readonly maxLiveTextChars: number
  readonly maxLiveEvents: number
}

/** Own one interactive Session view; closing or switching away detaches its waiter without cancelling Host work. */
export class NativeConversationController {
  private snapshot: ConversationSnapshot = { sessions: [], events: [], state: 'loading', navigationPending: false }
  private readonly listeners = new Set<() => void>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<void>>()
  private readonly background = new Set<Promise<void>>()
  private readonly drafts = new Map<SessionId, NativeConversationDraft>()
  private selectionEpoch = 0
  private navigation = 0
  private submissionRead = 0
  private submissionFloor = -1
  private submissionDraft: {
    sessionId: SessionId
    epoch: number
    text: string
    placement: 'queued' | 'steering'
    requestId: NativeSubmissionRequestId
  } | undefined
  private turn: AbortController | undefined
  private turnDetach = new AbortController()
  private handingOff = false
  private foregroundAdmission: { readonly sessionId: SessionId; readonly lastSeq: number } | undefined
  private followErrorOwner: { readonly sessionId: SessionId; readonly lastSeq: number } | undefined
  private closing: Promise<void> | undefined

  /**
   * @param client - selected Host Session Consumer; this controller does not close the shared Provider.
   * @param limits - maximum retained live presentation.
   */
  constructor(private readonly client: NativeSessionClient, private readonly limits: NativeConversationLimits) {}

  /** Read the current conversation view.
   * @returns immutable view snapshot, stable until an operation publishes a change. */
  readonly getSnapshot = (): ConversationSnapshot => this.snapshot

  /** Reserve the next navigation token.
   * @param disableSending - whether to block submissions while navigation resolves.
   * @returns next navigation token.
   */
  beginNavigation(disableSending = false): number {
    const token = ++this.navigation
    this.publish({ navigationPending: disableSending })
    return token
  }

  /** Check whether a navigation token is still current.
   * @param token - navigation token to check.
   * @returns whether the token is current.
   */
  isCurrentNavigation(token: number): boolean { return token === this.navigation }

  /** Wait for controller operations already in flight to settle.
   * @returns completion after no tracked operations remain pending.
   */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
  }

  /** Release a current navigation's composer lock without exposing an error.
   * @param token - navigation token whose composer lock should be released.
   * @returns no value.
   */
  releaseNavigation(token: number): void {
    if (!this.isCurrentNavigation(token)) return
    this.publish({ navigationPending: false })
  }

  /** Clear a current navigation's sending lock and expose its failure.
   * @param token - navigation token that failed.
   * @param error - failure returned by the navigation operation.
   * @returns no value.
   */
  failNavigation(token: number, error: unknown): void {
    if (!this.isCurrentNavigation(token)) return
    this.publish({ navigationPending: false, error: error instanceof Error ? error.message : String(error) })
  }

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
      if (!this.handingOff) this.publish({ state: 'ready' })
    })
    this.pending.add(pending)
    return pending
  }

  private assertReady(): void {
    if (this.snapshot.state !== 'ready') throw new Error('native conversation: operation already pending')
  }

  /** Keep a non-empty draft for a Session, deleting an empty draft.
   * @param id - owning Session.
   * @param draft - unsent composer text and image files.
   */
  keepDraft(id: SessionId, draft: NativeConversationDraft): void {
    if (draft.text.length === 0 && draft.files.length === 0) this.drafts.delete(id)
    else this.drafts.set(id, draft)
  }

  /** Take and remove a Session's saved draft.
   * @param id - owning Session.
   * @returns the saved draft, if one exists.
   */
  takeDraft(id: SessionId): NativeConversationDraft | undefined {
    const draft = this.drafts.get(id)
    this.drafts.delete(id)
    return draft
  }

  private async restore(id: SessionId, resumeTurn = true): Promise<void> {
    // Controls can cold-open the Session and append its end-seed marker, so history is read last.
    const modeControls = await this.client.modeControls(id, this.lifetime.signal)
    const permissionControls = await this.client.permissionControls(id, this.lifetime.signal)
    const history = await this.client.history(id, this.lifetime.signal)
    this.publish({ selected: id, header: history.header, events: history.events, modeControls, permissionControls,
      ...this.snapshot.selected === id ? {} : { submissions: undefined } })
    await this.refreshSubmissions(id, this.selectionEpoch)
    // With no active turn this still re-reads history once: the turn may have settled before attach.
    if (resumeTurn) await this.followTurn(id, history.events.at(-1)?.seq ?? -1,
      (signal, admission, observe, onFollowError, detach) => this.client.attach(
        id, admission.lastSeq, observe, signal, onFollowError, detach))
  }

  private beginSelection(): void {
    this.selectionEpoch++
    this.navigation++
    this.submissionFloor = -1
    this.submissionDraft = undefined
    this.publish({ navigationPending: false, submissionBusy: false, submissionError: undefined })
  }

  private async refreshSubmissions(id: SessionId, epoch: number): Promise<void> {
    if (this.selectionEpoch !== epoch || this.snapshot.selected !== id || this.lifetime.signal.aborted) return
    const read = ++this.submissionRead
    try {
      const value = await this.client.submissions(id, this.lifetime.signal)
      if (this.selectionEpoch !== epoch || this.snapshot.selected !== id || read !== this.submissionRead) return
      if (value.throughSeq < this.submissionFloor
        || value.throughSeq < (this.snapshot.submissions?.throughSeq ?? -1)) return
      this.publish({ submissions: value })
    } catch (error: unknown) {
      if (this.selectionEpoch === epoch && this.snapshot.selected === id && read === this.submissionRead) {
        this.publish({ submissionError: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  private async followTurn(
    id: SessionId, lastSeq: number,
    runTurn: (signal: AbortSignal, admission: { sessionId: SessionId; lastSeq: number },
      observe: (frame: NativeSessionFollowFrame) => void, onFollowError: (error: unknown) => void, detach: AbortSignal) =>
    Promise<{ readonly exitCode: number; readonly answer?: string } | undefined>,
    ownsFromStart = true,
  ): Promise<void> {
    const turn = new AbortController()
    const turnDetach = new AbortController()
    const admission = { sessionId: id, lastSeq }
    this.turn = turn
    this.turnDetach = turnDetach
    if (ownsFromStart) {
      this.foregroundAdmission = admission
      this.followErrorOwner = admission
    }
    this.publish({ state: 'sending', error: undefined, liveText: undefined, liveTruncated: false })
    let turnFailed = false
    try {
      const result = await runTurn(turn.signal, admission,
        (frame) => { this.observe(frame, admission) },
        (error) => {
          if (this.followErrorOwner === admission && this.snapshot.selected === id && !turn.signal.aborted
            && !this.lifetime.signal.aborted) {
            this.publish({ error: error instanceof Error ? error.message : String(error) })
          }
        }, AbortSignal.any([this.lifetime.signal, turnDetach.signal]))
      if (result !== undefined && result.exitCode !== 0 && result.exitCode !== 130) {
        throw new Error(`native conversation: turn exited with code ${result.exitCode}`)
      }
    } catch (error: unknown) {
      // A detach only stops this view's waiter; the Host turn keeps running.
      if (!turnDetach.signal.aborted && !turn.signal.aborted) {
        turnFailed = true
        throw error
      }
    } finally {
      if (this.foregroundAdmission === admission) this.foregroundAdmission = undefined
      if (this.turn === turn) this.turn = undefined
      this.publish({ liveText: undefined, liveTruncated: false, human: undefined, answeringHuman: false })
      if (!turnDetach.signal.aborted && !this.lifetime.signal.aborted && this.snapshot.selected === id) {
        try { await this.restore(id, false) }
        catch (error: unknown) { if (!turnFailed) throw error }
      }
    }
  }

  /** Re-read the selected Host inbox without changing turn readiness.
   * @returns completion after the Host snapshot or a visible read failure.
   */
  refreshPendingSubmissions(): Promise<void> {
    const id = this.snapshot.selected
    if (id === undefined) return Promise.resolve()
    this.publish({ submissionError: undefined })
    const work = this.refreshSubmissions(id, this.selectionEpoch)
    this.pending.add(work)
    void work.finally(() => { this.pending.delete(work) })
    return work
  }

  /** Submit text to the current turn's next-turn or next-step inbox.
   * @param text - nonempty human text; failed retries retain the same request identity.
   * @param placement - requested inbox; Host acknowledgement decides acceptance.
   * @returns true only after acceptance; false retains the composer's draft.
   */
  submitPending(text: string, placement: 'queued' | 'steering'): Promise<boolean> {
    const id = this.snapshot.selected
    if (id === undefined || this.snapshot.state !== 'sending' || this.snapshot.navigationPending === true
      || this.snapshot.submissionBusy || text.trim() === '') return Promise.resolve(false)
    const epoch = this.selectionEpoch
    const previous = this.submissionDraft
    const draft = previous?.sessionId === id && previous.epoch === epoch && previous.text === text && previous.placement === placement
      ? previous : { sessionId: id, epoch, text, placement, requestId: nativeSubmissionRequestId(randomUUID()) }
    this.submissionDraft = draft
    return this.mutateSubmission(id, epoch, async () => {
      // A lost acknowledgement can leave an accepted or already-claimed request on the Host.
      if (previous === draft) {
        await this.refreshSubmissions(id, epoch)
        if (this.snapshot.submissions?.submissions.some(item => item.requestId === draft.requestId)
          || this.snapshot.events.some(event => event.type === 'user/message' && event.data.id === String(draft.requestId))) {
          this.submissionDraft = undefined
          return true
        }
      }
      const result: NativeSubmissionAcknowledgement = placement === 'queued'
        ? await this.client.queue(id, text, draft.requestId, this.lifetime.signal)
        : await this.client.steer(id, text, draft.requestId, this.lifetime.signal)
      if (result.requestId !== draft.requestId) throw new Error('native conversation: submission acknowledgement identity mismatch')
      if (this.submissionDraft === draft) this.submissionDraft = undefined
      return true
    })
  }

  private mutateSubmission(id: SessionId, epoch: number, operation: () => Promise<boolean>): Promise<boolean> {
    this.publish({ submissionBusy: true, submissionError: undefined })
    const work = (async () => {
      try { return await operation() }
      catch (error: unknown) {
        if (this.selectionEpoch === epoch && this.snapshot.selected === id) {
          this.publish({ submissionError: error instanceof Error ? error.message : String(error) })
        }
        return false
      } finally {
        await this.refreshSubmissions(id, epoch)
        if (this.selectionEpoch === epoch && this.snapshot.selected === id) this.publish({ submissionBusy: false })
      }
    })()
    const pending = work.then(() => {})
    this.pending.add(pending)
    void pending.finally(() => { this.pending.delete(pending) })
    return work
  }

  /** Remove or promote one displayed pending request using its Host identity.
   * @param requestId - identity from the current Host snapshot.
   * @param action - remove from the inbox, or promote queued text to next-step.
   * @returns acknowledgement followed by a fresh Host inbox snapshot.
   */
  changePending(requestId: NativeSubmissionRequestId, action: 'remove' | 'promote'): Promise<boolean> {
    const id = this.snapshot.selected
    if (id === undefined || this.snapshot.submissionBusy || this.snapshot.state === 'loading'
      || this.snapshot.state === 'closed' || this.snapshot.state === 'cancelling' || this.snapshot.navigationPending === true
      || !this.snapshot.submissions?.submissions.some(item => item.requestId === requestId)) return Promise.resolve(false)
    return this.mutateSubmission(id, this.selectionEpoch, async () => {
      if (action === 'remove') await this.client.dequeue(id, requestId, this.lifetime.signal)
      else await this.client.promoteSubmission(id, requestId, this.lifetime.signal)
      return true
    })
  }

  /** Replace one pending request's complete text while retaining its Host identity.
   * @param requestId - identity from the current Host snapshot.
   * @param text - complete replacement text.
   * @returns true after the Host updates the request; false when it is stale or the edit fails.
   */
  editPending(requestId: NativeSubmissionRequestId, text: string): Promise<boolean> {
    const id = this.snapshot.selected
    if (id === undefined || this.snapshot.submissionBusy || this.snapshot.state === 'loading'
      || this.snapshot.state === 'closed' || this.snapshot.state === 'cancelling' || this.snapshot.navigationPending === true
      || text.trim() === ''
      || !this.snapshot.submissions?.submissions.some(item => item.requestId === requestId)) return Promise.resolve(false)
    const epoch = this.selectionEpoch
    return this.mutateSubmission(id, epoch, async () => {
      const result = await this.client.editSubmission(id, requestId, text, this.lifetime.signal)
      return result.outcome === 'updated'
    })
  }

  private async refreshModeControls(id: SessionId): Promise<void> {
    const modeControls = await this.client.modeControls(id, this.lifetime.signal)
    if (!this.lifetime.signal.aborted && this.snapshot.selected === id) this.publish({ modeControls })
  }

  private async refreshPermissionControls(id: SessionId): Promise<void> {
    const permissionControls = await this.client.permissionControls(id, this.lifetime.signal)
    if (!this.lifetime.signal.aborted && this.snapshot.selected === id) this.publish({ permissionControls })
  }

  private startRosterFollow(): Promise<void> {
    const iterator = this.client.follow(this.lifetime.signal)[Symbol.asyncIterator]()
    return (async () => {
      const first = await iterator.next()
      if (first.done || first.value.type !== 'baseline') throw new Error('native conversation: Session list follow has no baseline')
      this.publish({ sessions: first.value.items })
      const following = (async () => {
        try {
          while (true) {
            const next = await iterator.next()
            if (next.done) return
            this.applyRosterFrame(next.value)
          }
        } catch (error: unknown) {
          if (!this.lifetime.signal.aborted) this.publish({ error: error instanceof Error ? error.message : String(error) })
        }
      })()
      this.background.add(following)
      void following.finally(() => { this.background.delete(following) })
    })()
  }

  private applyRosterFrame(frame: NativeSessionListFrame): void {
    if (frame.type === 'baseline') {
      this.publish({ sessions: frame.items })
      return
    }
    const sessions = [...this.snapshot.sessions]
    if (frame.type === 'remove') {
      this.publish({ sessions: sessions.filter(item => item.header.id !== frame.sessionId) })
      return
    }
    const index = sessions.findIndex(item => item.header.id === frame.item.header.id)
    if (index === -1) sessions.push(frame.item)
    else sessions[index] = frame.item
    sessions.sort((left, right) => right.updatedAt - left.updatedAt)
    this.publish({ sessions })
  }

  private async restoreSelected(id: SessionId): Promise<void> {
    if (this.snapshot.selected === id) await this.restore(id)
  }

  /** Read the persisted index without automatically resuming a Session.
   * @returns completion after the initial index request.
   */
  load(): Promise<void> {
    return this.run(async () => {
      const modelControls = this.client.modelControls(this.lifetime.signal)
      await this.startRosterFollow()
      this.publish({ modelControls: await modelControls, error: undefined })
    })
  }

  /** Create and select a durably stored blank Session.
   * @returns completion after its header and history are available.
   */
  create(): Promise<void> {
    this.assertReady()
    this.followErrorOwner = undefined
    this.beginSelection()
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      const { sessionId } = await this.client.create(this.lifetime.signal)
      await this.restore(sessionId)
    })
  }

  /** Select a stored Session and reconstruct its durable transcript, attaching to a running Host turn.
   * Switching away detaches this view without cancelling that turn.
   * @param id - identity from the Host's index.
   * @returns history and any running-turn attachment completion.
   */
  async select(id: SessionId): Promise<void> {
    await this.detachTurn()
    this.followErrorOwner = undefined
    this.beginSelection()
    this.publish({ state: 'loading', error: undefined })
    await this.run(() => this.restore(id))
  }

  /** Clear the selected Session and its conversation projection, detaching a running turn without cancelling it.
   * @returns completion after any detached turn's view settles.
   * @throws If another operation such as loading is pending.
   */
  async deselect(): Promise<void> {
    await this.detachTurn()
    this.followErrorOwner = undefined
    this.beginSelection()
    this.publish({ state: 'ready', selected: undefined, header: undefined, events: [], modeControls: undefined,
      permissionControls: undefined, submissions: undefined, error: undefined })
  }

  private async detachTurn(): Promise<void> {
    if (this.snapshot.state !== 'sending' && this.snapshot.state !== 'cancelling') {
      this.assertReady()
      // Claim the controller before yielding so a concurrent select or deselect is refused.
      this.publish({ state: 'loading', error: undefined })
      return
    }
    // Stay loading while the detached turn settles so no other operation starts in between.
    this.followErrorOwner = undefined
    this.turnDetach.abort()
    this.handingOff = true
    this.publish({ state: 'loading', error: undefined })
    try { await Promise.allSettled([...this.pending]) } finally { this.handingOff = false }
  }

  /** Clear the selected Session and return the conversation to its empty state. */
  clear(): void {
    this.assertReady()
    this.followErrorOwner = undefined
    this.beginSelection()
    this.publish({ selected: undefined, header: undefined, modeControls: undefined, permissionControls: undefined,
      submissions: undefined, human: undefined, answeringHuman: undefined, submissionBusy: false, submissionError: undefined,
      events: [], liveText: undefined, liveTruncated: undefined, error: undefined, state: 'ready' })
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
      await this.restoreSelected(id)
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
      await this.restoreSelected(id)
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

  /** Select a registered mode before the first turn locks the root epoch.
   * @param preset - identifier advertised by the Host's standing registry.
   * @returns completion after Host selection and refreshed Session controls.
   */
  selectPreset(preset: string): Promise<void> {
    this.assertReady()
    const id = this.snapshot.selected
    const controls = this.snapshot.modeControls
    if (id === undefined || controls === undefined) throw new Error('native conversation: mode controls unavailable')
    if (controls.locked) throw new Error('native conversation: mode is locked by the first turn')
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      try { await this.client.selectPreset({ id, preset,
        expectedRevision: controls.revision === null ? null : SessionSeq(controls.revision) }, this.lifetime.signal) }
      finally { if (!this.lifetime.signal.aborted) await this.restore(id) }
    })
  }

  /** Select a standing permission policy for the selected Session.
   * @param preset - configured permission preset id.
   * @returns completion after Host selection and a refreshed permission value.
   */
  selectPermissionPreset(preset: string): Promise<void> {
    this.assertReady()
    const id = this.snapshot.selected
    if (id === undefined || this.snapshot.permissionControls?.available !== true) {
      throw new Error('native conversation: permission controls unavailable')
    }
    this.publish({ state: 'loading', error: undefined })
    return this.run(async () => {
      try { await this.client.selectPermissionPreset(id, preset, this.lifetime.signal) }
      finally { if (!this.lifetime.signal.aborted) await this.refreshPermissionControls(id) }
    })
  }

  /** Change plan mode without changing the active turn's busy state.
   * @param active - requested plan-mode state.
   * @returns completion after the Host reply or after mode controls refreshes following a rejection.
   */
  selectPlanMode(active: boolean): Promise<void> {
    const id = this.snapshot.selected
    const controls = this.snapshot.modeControls
    if (id === undefined || controls?.planMode.available !== true) {
      throw new Error('native conversation: plan mode unavailable')
    }
    const work = (async () => {
      try {
        const result = await this.client.selectPlanMode(id, active, this.lifetime.signal)
        if (this.snapshot.selected === id && this.snapshot.modeControls !== undefined) {
          this.publish({ error: undefined, modeControls: { ...this.snapshot.modeControls,
            planMode: { available: true, active: result.active,
              ...result.pending === undefined ? {} : { pending: result.pending } } } })
        }
      } catch (error: unknown) {
        this.publish({ error: error instanceof Error ? error.message : String(error) })
        if (!this.lifetime.signal.aborted && this.snapshot.selected === id) {
          try { await this.refreshModeControls(id) }
          catch (refreshError: unknown) {
            this.publish({ error: refreshError instanceof Error ? refreshError.message : String(refreshError) })
          }
        }
      }
    })()
    this.pending.add(work)
    void work.finally(() => { this.pending.delete(work) })
    return work
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
   * @param text - submitted text; empty text requires at least one image.
   * @param files - browser-selected raster files; Provider limits govern admission.
   * @returns completion after Host settlement and transcript refresh, or after this view detaches.
   */
  send(text: string, files: readonly File[] = []): Promise<void> {
    this.assertReady()
    if (this.snapshot.navigationPending === true) throw new Error('native conversation: navigation already pending')
    const id = this.snapshot.selected
    if (id === undefined || (text.trim().length === 0 && files.length === 0)) {
      throw new Error('native conversation: select a Session and enter text or attach an image')
    }
    const retainedDraft = this.submissionDraft
    const reconcileDraft = retainedDraft !== undefined && files.length === 0 && retainedDraft.sessionId === id
      && retainedDraft.epoch === this.selectionEpoch && retainedDraft.text === text ? retainedDraft : undefined
    if (reconcileDraft === undefined) this.submissionDraft = undefined
    return this.run(() => this.followTurn(id, this.snapshot.events.at(-1)?.seq ?? -1,
      async (signal, admission, observe, onFollowError, detach) => {
        const workSignal = AbortSignal.any([signal, detach])
        if (reconcileDraft !== undefined) {
          // A ready retry checks the Host receipt before starting another turn.
          const read = ++this.submissionRead
          const reads = await Promise.all([
            this.client.submissions(id, workSignal), this.client.history(id, workSignal),
          ])
          workSignal.throwIfAborted()
          const [submissions, history] = reads
          const matched = submissions.submissions.some(item => item.requestId === reconcileDraft.requestId)
            || history.events.some(event => event.type === 'user/message' && event.data.id === String(reconcileDraft.requestId))
          const selected = this.selectionEpoch === reconcileDraft.epoch && this.snapshot.selected === id
          if (selected) this.publish({ header: history.header, events: history.events })
          if (selected && read === this.submissionRead && submissions.throughSeq >= this.submissionFloor
            && submissions.throughSeq >= (this.snapshot.submissions?.throughSeq ?? -1)) {
            this.publish({ submissions, submissionError: undefined })
          }
          if (matched) {
            if (this.submissionDraft === reconcileDraft) this.submissionDraft = undefined
            this.publish({ error: undefined })
            return undefined
          }
          if (this.submissionDraft === reconcileDraft) this.submissionDraft = undefined
          admission.lastSeq = history.events.at(-1)?.seq ?? -1
        }
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
                workSignal.removeEventListener('abort', abort)
                reader.onload = reader.onerror = reader.onabort = null
              }
              reader.onload = () => {
                cleanup()
                const dataUrl = reader.result as string
                resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
              }
              reader.onerror = () => { cleanup(); reject(new Error('native conversation: image read failed', { cause: reader.error })) }
              reader.onabort = (): void => { cleanup(); resolve(undefined) }
              workSignal.addEventListener('abort', abort, { once: true })
              if (workSignal.aborted) abort()
              else reader.readAsDataURL(file)
            })
            if (data === undefined) return
            images.push({ mediaType, data, name: file.name })
          }
        }
        workSignal.throwIfAborted()
        this.foregroundAdmission = admission
        this.followErrorOwner = admission
        if (reconcileDraft !== undefined) this.publish({ error: undefined })
        return text.trim().length === 0
          ? this.client.promptContent(id, images.map((image): NativeSessionInputPart => ({ type: 'image', ...image })),
            true, signal, observe, onFollowError, admission.lastSeq, detach)
          : this.client.prompt(id, text, true, signal, observe, images, onFollowError, admission.lastSeq, detach)
      }, reconcileDraft === undefined))
  }

  private observe(frame: NativeSessionFollowFrame, admission: { readonly sessionId: SessionId; readonly lastSeq: number }): void {
    if (frame.type === 'baseline') {
      if (this.foregroundAdmission !== admission || this.snapshot.selected !== admission.sessionId) return
      if (frame.sessionId !== admission.sessionId || frame.fromSeq !== admission.lastSeq) {
        throw new Error('native conversation: follow baseline does not match the selected Session history')
      }
      return
    }
    if (frame.type === 'title-updated') {
      return
    }
    // The prompt reply can settle before its final inbox notifications drain.
    if (this.followErrorOwner === admission && this.snapshot.selected === admission.sessionId) {
      if (frame.type === 'event' && frame.event.type === 'user/message') {
        this.submissionFloor = Math.max(this.submissionFloor, frame.event.seq)
        void this.refreshPendingSubmissions()
      } else if (frame.type === 'submission-update') void this.refreshPendingSubmissions()
    }
    if (this.foregroundAdmission !== admission || this.snapshot.selected !== admission.sessionId) return
    if (frame.type === 'human') this.publish({ human: frame.prompt, answeringHuman: false })
    else if (frame.type === 'human-removed') { if (this.snapshot.human?.id === frame.id) this.publish({ human: undefined, answeringHuman: false }) }
    else if (frame.type === 'event') {
      const last = this.snapshot.events.at(-1)?.seq
      if (last !== undefined && frame.event.seq <= last) return
      if (last !== undefined && frame.event.seq !== last + 1) {
        throw new Error(`native conversation: live history sequence gap; expected ${last + 1}, received ${frame.event.seq} (${frame.event.type})`)
      }
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
      if (this.snapshot.selected === id && this.snapshot.human === prompt) {
        this.publish({ error: error instanceof Error ? error.message : String(error) })
      }
    }).finally(() => {
      this.pending.delete(work)
      if (this.snapshot.selected === id && this.snapshot.human === prompt) this.publish({ answeringHuman: false })
    })
    this.pending.add(work)
    return work
  }

  /** Stop the selected Host turn; settlement returns the conversation to ready without a cancellation error. */
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
