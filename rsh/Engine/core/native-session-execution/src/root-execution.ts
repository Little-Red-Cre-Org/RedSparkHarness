/** Program-selected root execution with immutable routing and exact maintenance ownership. */
import type { NativeAgentPresetFacts, NativeAgentPresetSelectionRequest } from '@deepseek-ai/dsh-agent-presets/selection'
import type { NativeRootRouteId } from './root-route.ts'
export type { NativeRootRouteId } from './root-route.ts'
import type { UserMessage } from '@deepseek-ai/dsh-llm/native'
import type { SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/native'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace-definition'
import type { NativeActiveSessionOwner } from './active-session.ts'
import type { NativeSessionConfiguration, NativeSessionTurnResult } from './index.ts'
import type { SessionDeletionId, SessionDeletionReceipt } from '@deepseek-ai/dsh-session-persistence/native'

/** Route-authorized recoverable storage mutations; no Agent or writer is created. */
export interface NativeRootSessionDeletionOperations {
  /** List retained deletions belonging to the selected route without activating Sessions.
   * @param request - exact route and positive maximum matching receipt count; overflow rejects.
   * @param signal - receipt scanning cancellation.
   * @returns detached receipts without workspace paths.
   */
  list(request: { readonly route: NativeRootRouteId; readonly limit: number },
    signal: AbortSignal): Promise<readonly SessionDeletionReceipt[]>
  /** Remove an inactive Session from the live persistence namespace.
   * @param request - exact Session identity and explicitly selected Program route.
   * @param signal - cancellation before storage accepts the namespace move.
   * @returns durable deletion receipt; original bytes remain recoverable.
   */
  delete(request: { readonly route: NativeRootRouteId; readonly id: SessionId },
    signal: AbortSignal): Promise<SessionDeletionReceipt>
  /** Restore retained bytes to an absent live identity under the same recorded workspace.
   * @param request - retained receipt and explicitly selected Program route.
   * @param signal - cancellation before storage accepts restoration.
   * @returns original Session identity without activation or a new turn.
   */
  restore(request: { readonly route: NativeRootRouteId; readonly id: SessionDeletionId }, signal: AbortSignal): Promise<SessionId>
}

/** Immutable configuration owned by the selected Program, without transferable policy authority. */
export interface NativeRootRoute {
  readonly id: NativeRootRouteId
  readonly configuration: Readonly<NativeSessionConfiguration>
  /** Explicit admission for selecting registered Workspaces; absent disables dynamic selection. */
  readonly workspaceSelection?: true
  /** Registered Workspace selected by the Program; absent on its configured base route. */
  readonly workspaceId?: WorkspaceId
}

/** Explicit root destination; restoration cannot replace an existing Agent or select another scope. */
export interface NativeRootSessionRequest {
  readonly route: NativeRootRouteId
  readonly id: SessionId
  readonly resume: boolean
  /** Explicit fresh-root composition; restoration uses accepted historical selection. */
  readonly preset?: string
}

/** One root input projected through the Program's existing executor and complete root epoch. */
export interface NativeRootExecutionRequest extends NativeRootSessionRequest {
  readonly message?: UserMessage
  /** Observe events only after the sole writer accepts their append. */
  readonly onEvent?: (event: SessionEvent) => void
}

/** Fork one closed source turn into a fresh root using the selected Program configuration. */
export interface NativeRootForkRequest {
  readonly route: NativeRootRouteId
  readonly source: SessionId
  readonly id: SessionId
  /** Existing source event whose containing turn must have a durable end; omitted selects the last closed turn. */
  readonly atSeq?: SessionSeq
}

/** Program-level capability; Providers reuse their existing root executor and writer ownership. */
export interface NativeRootExecutionOperations {
  /** Available only when the selected persistence Provider supplies recoverable deletion. */
  readonly deletions?: NativeRootSessionDeletionOperations
  /**
   * Wait until the Program has selected its actual immutable configuration and executor.
   * @param signal - caller cancellation; Program shutdown also rejects pending readiness.
   * @returns completion before resolving stored routes or admitting scheduled root work.
   */
  ready(signal: AbortSignal): Promise<void>
  /**
   * Resolve an explicitly configured route; unknown references fail before execution admission.
   * @param id - selected Program route identity.
   * @returns immutable route configuration bound to the existing Program policy scope.
   */
  resolve(id: NativeRootRouteId): Readonly<NativeRootRoute>
  /**
   * Read advertised dynamic routes without opening a Session or changing a domain.
   * @returns accepted immutable Workspace routes; disabled selection advertises none.
   */
  workspaceRoutes(): readonly Readonly<NativeRootRoute>[]
  /**
   * Select an existing registered Workspace under the Program's explicit directory and policy admission.
   * @param request - configured base route and branded Workspace identity; arbitrary cwd is not accepted.
   * @param signal - caller cancellation combined with Program lifetime.
   * @returns immutable route after canonical directory, policy and capacity validation.
   */
  selectWorkspace(request: { readonly baseRoute: NativeRootRouteId; readonly workspaceId: WorkspaceId },
    signal: AbortSignal): Promise<Readonly<NativeRootRoute>>
  /**
   * Withdraw a dynamic route after its exact Agent, writer and pending admissions have released.
   * @param id - branded dynamic route identity; the configured base route cannot be withdrawn.
   * @param signal - caller cancellation checked before withdrawal.
   */
  releaseWorkspace(id: NativeRootRouteId, signal: AbortSignal): Promise<void>
  /**
   * Capture routing from the exact currently attached root owner and its original registered Agent.
   * @param owner - live Program-owned root Session; delegated or released owners are rejected.
   * @returns the selected immutable Program route.
   */
  capture(owner: NativeActiveSessionOwner): Readonly<NativeRootRoute>
  /** Close the exact attached root Agent epoch and drain its execution, retained work and writer.
   * Callers must not await cancellation from inside the execution being closed.
   * @param owner - live root owned by this Program; released or foreign owners are rejected.
   * @returns completion after the original Agent registration and owned resources release; cleanup failures remain visible.
   */
  cancel(owner: NativeActiveSessionOwner): Promise<void>
  /**
   * Run a fresh or restored root through the existing executor, including autonomous root settlement.
   * @param request - explicit route and Session input; live identity conflicts are rejected.
   * @param signal - caller cancellation combined with Program and Agent lifetimes.
   * @returns settlement after the complete root epoch and its sole writer have released.
   */
  execute(request: NativeRootExecutionRequest, signal: AbortSignal): Promise<NativeSessionTurnResult>
  /**
   * Wait for the already admitted root epoch without creating an input or model turn.
   * @param request - explicit route and Session whose Program-owned work is observed.
   * @param signal - cancellation closes and drains the observed root epoch before rejection.
   * @returns final root turn settlement, or undefined when no root turn has settled.
   */
  settle(request: Pick<NativeRootSessionRequest, 'route' | 'id'>,
    signal: AbortSignal): Promise<NativeSessionTurnResult | undefined>
  /**
   * Execute an idle root transaction without manufacturing a turn or model request.
   * @param request - explicit route and fresh or restored Session destination.
   * @param operation - exact attached owner and effective cancellation; must not dispose its own execution.
   * @param signal - caller cancellation combined with Program and Agent lifetimes.
   * @returns callback value after durable persistence and idle transaction release.
   */
  maintenance<T>(request: NativeRootSessionRequest,
    operation: (owner: NativeActiveSessionOwner, signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T>
  /**
   * Copy a durable closed-turn prefix into a fresh root without sending an input or model request.
   * @param request - selected route, readable source, fresh destination and optional source event anchor.
   * @param signal - cancellation combined with Program and destination Agent lifetimes.
   * @returns destination identity after its inherited marker and copied events are durable.
   */
  fork(request: NativeRootForkRequest, signal: AbortSignal): Promise<SessionId>
  /**
   * Select a composition in an existing blank root and replace its immutable Agent epoch.
   * @param request - selected route, explicit preset and expected durable selection revision.
   * @param signal - caller cancellation before acceptance; accepted facts survive activation failure.
   * @returns accepted selection after old Agent drain and successor Agent registration.
   */
  selectPreset(request: NativeAgentPresetSelectionRequest & { readonly route: NativeRootRouteId },
    signal: AbortSignal): Promise<NativeAgentPresetFacts>
}

declare module '@deepseek-ai/dsh-native-runtime' {
  interface NativeServices {
    rootExecution: NativeRootExecutionOperations
  }
}
