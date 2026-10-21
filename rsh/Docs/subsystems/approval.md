# User Approval

English | [中文](approval.zh.md)

The approval seam of [compat-user-approval](../../Compatibility/DSH/bridge/compat-user-approval) answers one question: may this specific action proceed? The framework-free approval Definition owns shared request/outcome vocabulary and the durable policy projection; the compatibility package provides the `ctx.approval` dispatch service and `approval/request` answerer waterfall. UI channels may provide human answerers; the [ACP automation bridge](../../Programs/ACP/packages/acp) provides one-shot machine decisions for its own agents. Callers such as [dsh-tools](../../Engine/core/tools) and [dsh-tool-bash](../../Modules/Official/shell/tool-bash) consume the closed outcome and fail closed unless it is `allowed-once`.

Source: [`rsh/Compatibility/DSH/bridge/compat-user-approval/src/index.ts`](../../Compatibility/DSH/bridge/compat-user-approval/src/index.ts)

## Identity and outcome

Every request receives a fresh `ApprovalRequestId`. The brand pairs the `approval/asked` and `approval/decided` audit events without making approval ids interchangeable with tool-call or agent/session ids.

```ts type-equiv
/** Opaque identity pairing one compatibility approval question with its decision. */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome` is closed and fail-closed. `allowed-once` grants only the asked-about action; callers deny on `rejected`, `cancelled`, and `unavailable`. A missing, non-owning, throwing, or non-conforming answerer becomes `unavailable` rather than opening the gate.

```ts type-equiv
/** One-shot outcome returned by the compatibility answerer chain. */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## Per-session policy

`ApprovalPolicy` determines what happens before interactive answerers run. `ask` delegates to the composed answerer chain, whose no-answer default is `unavailable`; `never` deterministically returns `rejected` without dispatching any answerer. The effective value is the last `approval/policy` event in the Session log, falling back to the service config. The compatibility service reads the explicit override with `overrideOf(session)`; a live change uses `ctx.approval.setPolicy(agent, policy)`, while initial policy selection appends through `setApprovalPolicy(session, policy)`.

```ts type-equiv
/** Per-Session policy accepted by compatibility approval consumers. */
type ApprovalPolicy = 'ask' | 'never'
```

Both policies contribute their complete current meaning to the cache-safe runtime-context snapshot. The sourced `user/message` is the durable model-visible input; changing approval state appends a new full snapshot after retained history without touching the `system/message` nodes that hold the rendered system prompt.

## Approval request

`ApprovalRequest<AgentOwner>` identifies the request owner and tool action without importing an Agent implementation into the pure Definition. The compatibility API specializes `AgentOwner` to the full scoped `Agent`, preserving the live Session and injection operations its service uses. The request deliberately omits tool arguments: an answerer attaches the prompt to the already-streamed tool call through `callId` instead of rendering a second copy that could drift.

```ts type-equiv
/** Framework-free request passed to the compatibility approval service. */
interface ApprovalRequest<AgentOwner> {
  readonly agent: AgentOwner
  readonly toolName: string
  readonly callId?: ToolCallId
  readonly reason?: string
  readonly signal?: AbortSignal
}
```

## Dispatch and audit

`ctx.approval.request(req)` requires the requesting session to be inside an open turn. It appends `approval/asked`, obtains one outcome, appends the matching `approval/decided`, and resolves with that outcome. The `never` policy is enforced inside the service before waterfall dispatch, so even an answerer registered later with `prepend` cannot bypass it. Answerers return an outcome when they own the request or call `next()` to delegate; the first answer occupies the single decision slot.

The audit events are log-only and do not enter the model transcript. Model-visible behavior is the caller's derived tool result plus the current runtime-context snapshot. Service disposal removes its context contribution; answerer listeners are independently effect-bound to their owning plugins.

## Native profile approval

`dsh-native-approval` supplies a separate native `approval` Provider for profiles that use `NativeAgentRegistry` instead of a Cordis Agent. `NativeApprovalService` accepts the same closed outcome vocabulary and an `ask`/`never` deployment policy, confirms the exact registered native Agent, and calls its ordered answerers under `ask`. An answerer may return `undefined` to delegate; absent or failed answerers resolve `unavailable`, and Provider disposal resolves unsettled requests `cancelled`.

The native Provider owns neither a Session nor a Cordis event. Its consuming application records the `native-approval/asked` and `native-approval/decided` audit pair, then renders the tool outcome. Native headless applies this path to its fixed `write_file` tool and forwards it to a contributed tool that declares an approval reason. The distinct names keep native request ids and policy data separate from the user-approval audit payloads.

Source: [`rsh/Modules/Official/interaction/native-approval/src/index.ts`](../../Modules/Official/interaction/native-approval/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxapproval--approvalservicedefinition"></a>

### `ctx.approval` — `ApprovalServiceDefinition`

Cordis implementation specialized to the exact scoped Agent owner.

```ts cordis-catalog
/**
 * Set the durable per-Session approval policy for the live agent.
 * @param agent - live agent whose policy changes.
 * @param policy - next effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

/**
 * Ask the compatibility answerer chain for a decision inside the Agent's
 * open Session turn. The Provider appends `approval/asked` before dispatch
 * and `approval/decided` after the normalized outcome so the audit pair is
 * enclosed by that turn's durable log boundary. Calls made while no turn is
 * open reject before appending; a failure before either audit append commits
 * rejects the request. Post-commit observer failures are contained by
 * Session and do not reject the request or suppress its matching event.
 * @param request - exact operation and owner needing a decision.
 * @returns the fail-closed outcome.
 * @throws When the Session has no open turn or either audit append fails before commit.
 */
request(request: ApprovalRequest<Agent>): Promise<ApprovalOutcome>

/**
 * Read the explicit policy override recorded in the Session log.
 * @param session - Session with the durable policy fold.
 * @returns the explicit override or undefined.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

Types: [Agent](core.md) · [Session](session.md)

Source: [`rsh/Compatibility/DSH/bridge/compat-user-approval/src/types.ts`](../../Compatibility/DSH/bridge/compat-user-approval/src/types.ts)

<a id="approval-events"></a>

### `approval/*` events

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — waterfall

Ask composed answerers for one decision. Return an outcome to claim it or call `next()` to delegate. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) limits listeners to the requesting Agent's scope.

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome to claim it or call `next()` to delegate.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) limits listeners to the requesting Agent's scope.
 * @param req - pending approval request.
 * @mode waterfall
 */
'approval/request'( this: Scoped<Agent>, req: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>, ): Promise<ApprovalOutcome>
```

Types: [Agent](core.md) · [Scoped](scope.md)

Source: [`rsh/Compatibility/DSH/bridge/compat-user-approval/src/types.ts`](../../Compatibility/DSH/bridge/compat-user-approval/src/types.ts)
<!-- END GENERATED cordis-surface -->
