# Agent Note: Native request-context acceptance

Status: implemented

English | [中文](2026-10-13-native-request-context-acceptance.zh.md)

## Problem

Native request-context Providers add model-visible messages during a request, so their contributions must use the admitted inputs and tool registrations that the selected Program actually executes while preserving durable Session ownership.

## Decision

Native Headless root and delegated Programs use the same optional `requestContexts` service path. When providers are visible, Headless requires the exact active Session owner before claiming queued inputs. The request carries that owner, final admitted inputs, one durable event snapshot, and exact registration visibility from the model and PTC snapshots used for execution. Providers prepare detached messages and candidate state before the Program's final synchronous admission checks. The Program appends the step start, system message, admitted inputs and selection, instruction and time/tmux context, request-context messages, and request header/context through its existing writer, then flushes the exact owner before the registry commits prepared Provider state. An empty visible Provider set still reaches normal Program acceptance.

Tool visibility checks the captured registration disposer identities; it uses no additional catalog snapshot. This keeps provider decisions aligned with model schemas and PTC bindings after allowlists, scope shadowing, and delegated tool restrictions. Rejection before acceptance leaves prepared Provider messages and state uncommitted. Once an append or flush starts, the owner drains that write path instead of rolling it back.

## Alternatives considered

**Queue messages through `agent.inject`.** That path waits for a later inbox claim and cannot contribute to the request whose admission already selected its inputs.

**Let Providers append or flush the Session.** That gives each Provider a competing writer and separates its messages from the Program's final admission checks and request event ordering.

**Resolve tool visibility from names or a dedicated snapshot.** Names can refer to replacement registrations, and a visibility-only snapshot can differ from the model catalog or PTC bindings actually executed, especially for delegated subsets.

## Consequences

Providers own preparation and provider-local candidate state; the selected Program owns the exact Session, final admission, ordered append, and flush. Accepted messages are durable before model dispatch and reconstruct the request history. A request that has begun appending cannot be rolled back, so cancellation and disposal drain the exact owner and captured Provider work.

The contract keeps contexts optional. A composition without visible request-context Providers keeps the normal acceptance path, and a composition with Providers but no exact active owner fails before consuming queued input.

See the [request-context subsystem](../../../../rsh/Docs/subsystems/request-context.md), [Native Headless](../../../../rsh/Engine/core/native-headless/README.md), and [tool execution snapshot contract](../../../../rsh/Engine/core/native-tools/README.md).
