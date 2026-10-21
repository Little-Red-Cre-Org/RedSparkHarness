/** Shared durable workspace instruction composition for native and Cordis execution. */
import type { Session, UserMessage } from '@deepseek-ai/dsh-session/native'
import { createUserMessage } from '@deepseek-ai/dsh-llm/native'
import type { FileSystemOperations } from '@deepseek-ai/dsh-fs/native'
import { workspaceBaselineIdentity, type ResolvedConfig } from './config.ts'
import { findProjectRoot, loadBaselineInstructionSet } from './files.ts'
import { applyInstructionVersionUpdates, baselineInstructionState, reconcileInstructionContext,
  workspaceContextMessage, type InstructionVersionCache, type AgentInstructionSource } from './state.ts'
import type { AgentInstructionChange } from './render.ts'
function visibleBaselineSource(
  session: Session,
  authorityMessages: readonly UserMessage[],
): AgentInstructionSource | undefined {
  for (const message of authorityMessages.toReversed()) {
    if (message.source.kind === 'agent-instructions' && message.source.baseline === true) {
      return message.source
    }
  }
  for (const seq of session.surface.nodes.toReversed()) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = session.eventAt(seq)
    if (event?.type === 'user/message'
      && event.data.source.kind === 'agent-instructions'
      && event.data.source.baseline === true) return event.data.source
  }
  return undefined
}

/** Per-installation metadata caches; durable Session messages retain instruction authority. */
export class InstructionComposer {
  private readonly instructionVersions: InstructionVersionCache = new WeakMap()
  private readonly baselinePreparations = new WeakMap<Session, {
    identity: string
    excludedScopes: ReadonlySet<string>
  }>()
  /** @param resolved - complete discovery settings. @param fileSystem - selected execution filesystem. */
  constructor(private readonly resolved: ResolvedConfig, private readonly fileSystem: FileSystemOperations) {}
  /**
   * Prepare context against durable messages and the admitted request.
   * @param session - exact writer-owned Session.
   * @param signal - cancellation for all discovery reads.
   * @param claimed - messages admitted for this request.
   * @param pending - projected instruction messages awaiting admission.
   * @param touchedPaths - successfully accessed paths that enable nested discovery.
   * @param fileSystem - current provider; defaults to the installation provider.
   * @returns one durable instruction message, or undefined when unchanged.
   */
  async compose(
    session: Session,
    signal: AbortSignal,
    claimed: readonly UserMessage[],
    pending: readonly UserMessage[],
    touchedPaths: readonly string[] = [],
    fileSystem: FileSystemOperations = this.fileSystem,
  ): Promise<UserMessage | undefined> {
    const { resolved, instructionVersions, baselinePreparations } = this
    signal.throwIfAborted()
    if (resolved.maxBytes <= 0 || !Number.isFinite(resolved.maxBytes)) {
      return undefined
    }
    if (touchedPaths.length === 0 && pending.length > 0) return pending[0]
    const content: UserMessage['content'][number][] = []
    const changes: AgentInstructionChange[] = []
    let desiredBaseline = false
    const authorityMessages = [...claimed]
    /* v8 ignore next -- normal agents carry an absolute session cwd. */
    const cwd = session.header.cwd ?? process.cwd()
    const projectRoot = await findProjectRoot(cwd, resolved.projectRootMarkers, fileSystem, signal)
    const identity = workspaceBaselineIdentity(resolved, cwd, projectRoot)
    const visibleBaseline = visibleBaselineSource(session, authorityMessages)
    const baselinePresent = visibleBaseline !== undefined
    const keepVisibleBaseline = visibleBaseline?.baselineIdentity === identity
    const prepared = baselinePreparations.get(session)
    let excludedBaselineScopes = keepVisibleBaseline && prepared?.identity === identity
      ? prepared.excludedScopes
      : undefined
    let nextPreparation: { identity: string; excludedScopes: ReadonlySet<string> } | undefined
    if (!baselinePresent || !keepVisibleBaseline || excludedBaselineScopes === undefined) {
      const replacePreviousBaseline = baselinePresent && !keepVisibleBaseline
      const instructions = await loadBaselineInstructionSet({
        cwd,
        dshHome: resolved.dshHome,
        projectRootMarkers: resolved.projectRootMarkers,
        maxBytes: resolved.maxBytes,
        maxSourceBytes: resolved.maxSourceBytes,
        instructionFileCandidates: resolved.instructionFileCandidates,
        localInstructionFileCandidates: resolved.localInstructionFileCandidates,
        projectRoot,
        replacePreviousBaseline,
        signal,
      }, fileSystem)
      const baseline = baselineInstructionState(instructions?.included ?? [])
      const observedBaseline = baselineInstructionState(instructions?.observed ?? [])
      const excludedScopes = new Set(observedBaseline.changes.keys())
      for (const scope of baseline.changes.keys()) excludedScopes.delete(scope)
      excludedBaselineScopes = excludedScopes
      nextPreparation = { identity, excludedScopes }
      let versionStates = instructionVersions.get(session)
      if (versionStates === undefined && baseline.versions.size > 0) {
        versionStates = new Map()
        instructionVersions.set(session, versionStates)
      }
      for (const [scope, state] of baseline.versions) versionStates?.set(scope, state)
      if (!keepVisibleBaseline && instructions !== undefined && instructions.rendered.text.length > 0) {
        const baselineContent = workspaceContextMessage(instructions.rendered.text).content
        content.push(...baselineContent)
        const replacementScopes = new Set(baseline.changes.keys())
        const replacementRemovals = replacePreviousBaseline
          ? visibleBaseline.changes.flatMap(change => (
            change.action === 'remove' || replacementScopes.has(change.scope)
              ? []
              : [{ action: 'remove' as const, scope: change.scope, path: change.path }]
          ))
          : []
        const baselineChanges = [...replacementRemovals, ...baseline.changes.values()]
        changes.push(...baselineChanges)
        authorityMessages.push(createUserMessage({
          content: baselineContent,
          source: {
            kind: 'agent-instructions',
            form: 'instructions',
            baseline: true,
            baselineIdentity: identity,
            changes: baselineChanges,
          },
        }))
        desiredBaseline = true
      }
    }
    const update = await reconcileInstructionContext(
      { session },
      resolved,
      instructionVersions,
      fileSystem,
      {
        authorityMessages,
        scopeMessages: pending,
        includeBaselineScopes: keepVisibleBaseline,
        ...keepVisibleBaseline ? { excludedBaselineScopes } : {},
        touchedPaths,
        projectRoot,
        signal,
      },
    )
    if (update !== undefined) {
      content.push(...update.context.content)
      /* v8 ignore next -- reconciliation constructs only agent-instructions contexts. */
      if (update.context.source.kind === 'agent-instructions') {
        changes.push(...update.context.source.changes)
      }
      applyInstructionVersionUpdates(session, update.versionUpdates, instructionVersions)
    }
    if (nextPreparation !== undefined) baselinePreparations.set(session, nextPreparation)
    if (content.length === 0) return undefined
    return createUserMessage({
      content,
      source: {
        kind: 'agent-instructions',
        form: 'instructions',
        ...desiredBaseline ? { baseline: true } : {},
        ...desiredBaseline ? { baselineIdentity: identity } : {},
        changes,
      },
    })
  }
}
