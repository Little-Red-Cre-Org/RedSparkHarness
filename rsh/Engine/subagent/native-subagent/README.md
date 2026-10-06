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

The native entry requires sessionExecution and promptSections, optionally consumes tools and jobs, and provides subagents. Configuration requires providerName. The shipped native-sdk profile installs this Provider with the native tool-subagent Consumer; other native profiles may compose the same modules explicitly.

<a id="ownership"></a>
## Ownership

Resolve captures the exact parent owner, latest logged provider/model/effort, workspace and budgets. Child route overrides clear inherited effort unless explicitly selected. Each fresh child has its own durable Session and descriptor. The existing executor enforces depth, owns the sole writer, and releases child-scoped prompt and tool restrictions. Children disable builtin tools, inherit selected sandbox policy, and cannot request permission expansion. Foreground cancellation and unload drain accepted execution; cleanup failures reject. A child’s recorded model error returns its actual partial output and error stop reason; an unrecorded failure still rejects. `start()` publishes the child id only after the selected executor reports readiness with its initial durable facts committed; failed startup rejects after rollback. With `outputSchema`, the child must commit one schema-valid `structured_output` result. Invalid attempts remain retryable, but another call is rejected after a successful commit, and normal completion without a commit returns an error stop reason.

Background execution copies the same resolved child permissions and budgets. The Provider exposes its selected registry as backgroundJobs. continuationTools identifies the selected registry for child permission restrictions; continuation controls must select that same registry. Jobs owns bounded live text and final output; job_kill requests cancellation and job_output with wait waits for terminal cleanup. Caller cancellation owns startup until actual child readiness; after publication, the parent Agent, Jobs cancellation and Provider unload own the child independently of ordinary parent turns.

Continuable starts commit the descriptor and initial inbox acceptance through the Program before returning. sendMessage permits direct-parent/child adjacency, restores closed direct children from their durable descriptor, and returns the accepted message id independently of an answer. list reads the selected Program's durable catalog without loading Agents, traverses ordinary and one-shot intermediaries, and returns only this Provider's continuable descriptors with actual resident status or per-item read diagnostics. Cold resume preserves route, persona, tool restrictions and workspace; activation budgets use the selected deployment defaults. interrupt stops current work and parks unclaimed input until another message wakes it. Parent disposal and Provider unload drain resident children; execution and cleanup failures reject.

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
- External backends are not provided by this entry. The native SDK consumes the Provider's settled-result observer for exact in-process child lineage; this package does not send SDK wire notifications itself.
- No invariant companion is published: the Program retains Agent, Session and writer authority; the Provider owns only its accepted calls and scoped setup.

<a id="dev-note"></a>
### Dev Note

[Native spawn ownership](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-spawn.md).

[Background ownership](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-background.md).

[Continuation ownership](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-continuation.md).

[Settlement admission](../../../../.agents/notes/implemented/architecture/2026-10-05-native-subagent-settlement.md).
