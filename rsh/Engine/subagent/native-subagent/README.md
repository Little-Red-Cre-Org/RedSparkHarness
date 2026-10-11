---
description: "The native Subagent Definition and selected in-process spawn Provider delegate through the active Program executor."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-subagent

English | [中文](README.zh.md)

## Summary

The native Subagent Definition and selected in-process spawn Provider delegate through the active Program executor.

## Table of Contents

- [Configuration](#configuration)
- [Ownership](#ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The native entry requires sessionExecution, activeSessions and promptSections, optionally consumes tools, jobs and `externalSubagentDriver`, and provides subagents. Configuration requires providerName. `spawn` selects the in-process executor and remains the shipped profile default. Any other name must match the single external driver selected in the same Native Host installation; its optional-service dependency makes the Subagent Provider drain before that driver is disposed. The shipped native-sdk profile installs this Provider with the native tool-subagent Consumer; other profiles must select an external Module explicitly.

<a id="ownership"></a>
## Ownership

Resolve captures the exact parent owner, latest logged provider/model/effort, workspace and budgets. A nested call from an external child resolves against that child's effective route, workspace, depth and resource ceilings; inherited model, builtin and program tool names are intersected with the next child filter, so nested delegation cannot restore a removed capability. Child route overrides clear inherited effort unless explicitly selected. Each fresh child has its own durable Session and descriptor. The existing executor enforces depth, owns the sole writer, and releases child-scoped prompt and tool restrictions. Children disable builtin tools, inherit selected sandbox policy, and cannot request permission expansion. Foreground cancellation and unload drain accepted execution; cleanup failures reject. A child’s recorded model error returns its actual partial output and error stop reason; an unrecorded failure still rejects. `start()` publishes the child id only after the selected executor reports readiness with its initial durable facts committed; failed startup rejects after rollback. With `outputSchema`, the child must commit one schema-valid `structured_output` result. Invalid attempts remain retryable, but another call is rejected after a successful commit, and normal completion without a commit returns an error stop reason.

An external provider is one-shot only. `resolve()` issues a private one-use admission tied to the exact active parent and invocation-root owners, their epochs, the selected driver, and the resolved route, workspace and budgets. Copies, replay and replaced owners are rejected before launch. The driver receives a detached request DTO with Session ids and epochs, never a Native Agent, Session, Cordis Context or writer. Unsupported route fields or child restrictions are rejected before launch; limits come from the parent and can only be reduced. The driver returns from `start()` only after its real child is ready. Native appends and flushes `subagent/external-start` through the parent’s sole writer before publishing readiness, then appends and flushes `subagent/external-end` only after the driver confirms its complete child range is quiescent. Parent detach closes new input admission, cancels and drains accepted children, and keeps that writer available for the terminal fact until detached Consumers finish. An ordinary child-result rejection reaches the caller after successful cleanup; it does not fail owner drains or Provider disposal. Range-cleanup and parent-lineage persistence failures remain sticky for the exact owners and Provider.

Background execution copies the same resolved child permissions and budgets. The Provider exposes its selected registry as backgroundJobs. continuationTools identifies the selected registry for child permission restrictions; continuation controls must select that same registry. Jobs owns bounded live text and final output; job_kill requests cancellation and job_output with wait waits for terminal cleanup. Caller cancellation owns startup until actual child readiness; after publication, the parent Agent, Jobs cancellation and Provider unload own the child independently of ordinary parent turns.

Continuable starts commit the descriptor and initial inbox acceptance through the Program before returning. sendMessage permits direct-parent/child adjacency, restores closed direct children from their durable descriptor, and returns the accepted message id independently of an answer. list reads the selected Program's durable catalog without loading Agents, traverses ordinary and one-shot intermediaries, and returns only this Provider's continuable descriptors with actual resident status or per-item read diagnostics. Cold resume preserves route, persona, tool restrictions and workspace. V4 inherited Native children also persist logical depth and direct, builtin and program grants; resume requires current inherited authority and intersects those grants and persistent resource ceilings. The descriptor's child route remains authoritative, while the selected deployment defaults bound each activation. The shared Cordis Provider rejects V4 inherited context because it cannot restore those grants. The interrupt request asks the current turn to stop and parks unclaimed input until another message wakes the child. The request returns before turn cleanup finishes. Parent disposal and Provider unload drain resident children; execution and cleanup failures reject.

After a continuable child releases its writer and Agent, the Provider observes that residency's durable Session history and reports its actual result to registered consumers. It then delivers one subagent-settled notice through the exact parent's inbox while the selected Program remains open. The ending and closing content come only from this residency's durable suffix; cleanup failure reports error without an earlier answer. Root parents consume the queued notice on their next user turn; resident continuable parents use the existing wake path. Provider shutdown suppresses new notices while still publishing results for accepted residency epochs.

<a id="model-experience"></a>
## Model Experience

### Delegation input

#### What the model sees

The child receives its task, deployment persona, delegation permissions and filtered registered tools. Prompt rendering and tool schemas are recorded before each model request. The `subagent` tool receives actual foreground child content and stop reason after cleanup; background starts return a real child id and Jobs handle, and subsequent job_output results enter the parent log; SDK Session-tree observers receive accepted child events.

#### Token effect

The child task and prompt consume child tokens. Returning final or partial output, background acknowledgements, job output and settlement notices add parent history.

#### KV Cache effect

The child starts a fresh conversation; its request does not reuse the parent conversation prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Persona is literal scoped text; template-variable interpolation is unsupported.
- The external-operation broker logs each complete model request and response or failure through the captured parent writer, and reserves a conservative per-operation attempt ceiling before forwarding. Admission waits for the flushed `subagent/external-start` fact. It captures the exact parent-scoped model-tool catalog and executes only one-use grants projected from the logged response; each complete tool result is durable before captured Native acceptance, and its settlement is durable before the product receives the result. Accepted image references are resolved to verified bytes by the captured Headless attachment service after settlement persistence, and capture disposal drains those reads. `concludesTurn` blocks later inference. The Official Codex driver borrows the transport captured from the selected prepared model generation; the Engine closes it after product disposal and accepted model, tool and approval work drains. A parent `maxTokens` ceiling requires that generation to enforce the final projected `max_output_tokens`; missing transport and unsupported ceilings fail before child startup. Nested Responses calls inherit a process-local capability bound to the exact outer prepared generation; matching routes capture from that generation, while an explicit provider/model change prepares one child generation without changing its parent. Each child captures and closes its own transport. Shipped Providers do not yet provide the captured transport, so Native Responses children still fail before product startup. External-driver background runs remain unsupported, and both SDK event projections remain required for end-to-end Native Codex execution.
- No invariant companion is published: the Program retains Agent, Session and writer authority; the Provider owns only its accepted calls and scoped setup.

<a id="dev-note"></a>
### Dev Note

[Native spawn ownership](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-spawn.md).

[Background ownership](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-background.md).

[Continuation ownership](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-continuation.md).

[Settlement admission](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-settlement.md).

[External child ownership](../../../../.agents/notes/implemented/architecture/2026-10-08-native-external-subagent-driver.md).
