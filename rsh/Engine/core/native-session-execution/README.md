---
description: "Native active Session execution routing with exact ownership and quiescent contribution removal."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-session-execution

English | [中文](README.zh.md)

## Summary

`dsh-native-session-execution` publishes the `sessionExecution` and `activeSessions` Definitions and Provider. Programs register their existing active Session executor; delegation modules read its resolved configuration and request fresh child turns through that same owner. The registry creates no Agent, turn loop, Session or writer.

## Table of Contents

- [Configuration](#configuration)
- [Execution ownership](#execution-ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

NativeSessionConfiguration may explicitly select builtinTools. Delegation carries that resolved choice to the Program executor; omission retains that Program’s resolved selection. A restricted child composition must disable builtin capabilities and install its registered-tool restrictions before the first request.

The `./native` entry requires `agents`, provides `sessionExecution` and `activeSessions` and accepts an empty configuration. Unknown fields fail activation. Profiles explicitly select this Provider; this change does not alter application defaults.

<a id="execution-ownership"></a>
## Execution ownership

`owners()` returns a detached array of exact live writable owners. Read-only observers subscribe before enumerating it and deduplicate by owner identity, so a Provider attached after a Program still observes that existing writer without adopting it. Released owners and replaced Agent objects are excluded.

The ./root-route export owns the shared NativeRootRouteId brand without importing execution services. Host and Client use explicit compiler faces: only the pure route identifier is available on the Client face; active Session and root execution operations remain Host-owned. Workspace identity comes from the framework-independent Engine workspace-definition package.

`NativeActiveSessionOwner.appendBatch` admits related facts through the Program’s sole retained writer. Rejected batches track no events; accepted events retain their sequence order and `flush()` persists them through the existing durability barrier.

The Host-only `./read-history` utility reads through the selected exact live owner or an existing persistence reader without activating an Agent. Explicit history limits request one extra event to detect overflow and refuse truncation. Live ownership is rechecked after reading; cold reader closure is awaited, and teardown failures preserve any primary read failure and are reported to the calling request owner.

`NativeProgramInteractionOwner` describes a Program-selected live requester and its display root. Programs derive this read-only association from actual execution entry and delegation ancestry, independently of stored Session parent headers. Interaction Consumers must verify exact live Agent and Session identity before answering; a display root does not replace the requesting Session or its writer.

The Host `rootExecution.cancel(owner)` closes the exact attached root Agent epoch, including ordinary turns without retained residency. It rejects foreign or released owners and waits for execution, retained work, writer and registration cleanup. Cleanup failure remains visible and retains the closed execution entry, preventing a replacement from opening while resource release is uncertain. Successful cancellation permits a later resume through a new Agent epoch.

Delegation may supply `initialize(append)` to record child-owned facts inside the first turn and `onReady(agent)` to receive the registered child after those facts persist. The executor invokes both before the first model request. Initialization, checkpoint or publication failures reject after owned cleanup; modules do not gain direct writer access.

A Program calls `register()` with the exact registered Agent, matching active Session, resolved workspace/model/prompt/budgets and its existing child execution operation. Only one active contribution is admitted per Agent, including while its release drains. The returned release closes turn admission, cancels turn-owned delegations and waits for their executor settlement. It does not close the Program's writer or dispose its Agent.

`configuration()` and `delegate()` require the exact available Agent and Session objects and that Agent's current initiator attribution. Configuration is a detached immutable snapshot. A delegation preserves the selected executor's result or error. Contribution release drains turn-owned child operations; Agent release and Provider disposal cancel and drain both lifetimes; the executor remains responsible for child writer closure and Agent release. An owner must not await its own release from inside a child operation.

The [native turn executor](../native-headless/README.md) registers each active Session with its resolved configuration and removes the contribution before closing the parent writer. Each Program retains its separately resolved Session configuration; no global route is substituted. A replacement Provider implements the same Definition without replacing the Agent registry or Session storage.

`continuations.catalog()` supplies read-only candidate paths from the selected Program. `continuations.inspect()` checks their parent links and requires a subagent endpoint; the consumer interprets descriptor events. Neither operation creates an Agent or writer.

`lifetime` resolves to `turn` at admission unless the caller explicitly selects `agent`. Agent-owned delegation survives ordinary contribution removal and permits the next parent turn to register a new exact Session while the child continues. Admission still requires the current active parent; retained background work cannot admit calls through an expired Session. Its caller supplies the background owner's cancellation signal. Settlement removes the Agent cleanup contribution when no background operation remains.

A delegation may supply `prepare` to install child-scoped contributions before the executor renders system text or selects tool schemas. The callback receives the exact registered child and a bound resource owner. The executor waits for preparation, rollback and resource release before completing delegation; preparation and cleanup failures retain independent causes. `onReady` remains a publication callback after initial facts persist, not a setup window.

The `activeSessions` service publishes exact Program-owned Agent and Session access outside model-call initiator attribution. Registration awaits future attach observers before initial model admission. Release closes lookup admission, drains accepted attach callbacks and runs detach cleanup before Program writer teardown; observer removal also drains accepted callbacks. Failed attachment rolls back through detach cleanup. Copied Agents and copied Sessions cannot select an owner.

The active owner exposes validated history through its sole writer, tracked append/flush, detached durable inbox candidates and backend-accepted event observation. Its invocation is the current Program entry (`root` or `delegated`), independent of historical Session lineage. Ordered asynchronous step hooks delegate through `next()` and may select only unchanged captured candidates. A hook can register a synchronous commit check for the Program to run after request preparation; it can cancel only ids among that admission's selected candidates, and cannot return a Promise.

Residency retention is process-local Program ownership. A Consumer may retain a root writer across idle turns; releasing the exact lease permits natural closure. Cancellation and unload override retention and drain accepted work. Consumers may append only while `writerAvailable` and exact ownership remain valid. A closed owner fails loudly; the registry creates no alternate inbox, model loop or writer.

The active owner may expose `rootOperations` for an exact current root invocation. This Program-owned handle remains usable after ordinary writer closure while its original Agent is live. `runIdle()` synchronously rejects busy or disposed roots and temporarily restores the sole writer under idle maintenance; successful release may wake accepted pending input, while failure preserves durable inbox facts without a model request. Delegated invocations omit the handle. The registry owns no future timer or second executor.

The package also defines `rootExecution`; its selected Program supplies the Provider. `ready(signal)` waits for the actual executor and configuration, as defined by that Program. Explicit branded routes bind the Program's immutable configuration and existing scope; unknown routes fail before admission. `capture(owner)` accepts only the exact attached root. `execute()` waits for complete root settlement; `maintenance()` performs a durable root transaction without a model turn. These operations do not transfer permission authority or register another executor.

`fork(request, signal)` adds a fresh root destination using the selected Program route and a durable closed source turn. It returns the destination identity after copying the inherited prefix and persisting its exact cut. The Program owns source observation, Agent registration, cancellation and the only destination writer; Consumers cannot provide replacement seed events or transfer permissions through a source id.

The optional `rootExecution.deletions` capability delegates recoverable namespace removal and restoration to the selected persistence Provider. Its Program validates the recorded workspace and exact storage revision, refuses busy ownership, and drains accepted operations. Listing returns only matching route receipts under an explicit count limit. Missing capability supplies no deletion controls or fallback; archive metadata grants no deletion authority.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Program-owned executor, which records requested child messages and configuration; the registry contributes no model-visible text.

#### KV Cache effect

Routing and active-owner metadata do not alter model request content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Delegation operations must cooperate with cancellation; the registry has no process termination authority.
- The registry provides active ownership only. It does not implement named Subagent providers, descriptors, continuation inboxes, workflow scheduling or cold resume.
- No invariant companion is published: the active routing entry is the sole observation of its contribution, and the Program retains the Agent and durable Session authorities.

<a id="dev-note"></a>
### Dev Note

The [execution decision](../../../../.agents/notes/implemented/architecture/2026-10-05-native-session-execution-authority.md) records lifecycle ownership and acceptance scope.
