# Agent Note: Native Host subagent conversation, catalog, interrupt, and session fork

Status: implemented

English | [中文](2026-11-22-native-host-subagent-and-fork.zh.md)

## Problem

The Desktop Native Host can list ordinary Sessions and prompt a root turn, but it cannot fork a closed turn, list a parent's direct subagents, read or follow a child by its parent address, deliver a continuable prompt, or interrupt one child. The legacy Web Host already does those through Cordis session services. Rebuilding seed cutting, catalog projection, or continuation admission inside the Native Host would diverge from the Engine that already owns them. `profile: web` snapshots stay on the legacy composition until the remaining UI gaps close, and those snapshots need this Host behavior before they can move.

## Decision

The Native Web Session Host wraps the existing Engine operations. It does not reimplement seed cutting, persistence, or continuation admission.

`session/fork` accepts `{ sessionId, atSeq? }`. The Host mints `SessionId(randomUUID())`, resolves the source Program route, and calls `NativeRootExecutionOperations.fork` with `{ route, source, id, atSeq? }`. The source Session is not modified. A source that is neither a live owner nor a stored header is `session/not-found`. Engine text `fork source event does not exist` or `fork source turn has not closed` becomes `session/fork-unavailable`. Every other failure is `native/session` with a fixed message and empty details.

`subagents/list` accepts `{ parentSessionId }` and returns `{ entries, parentAvailable }` for direct children only. Continuable rows come from `NativeSubagentOperations.list`. One-shot rows and descriptor diagnostics come from stored headers plus `foldSubagentDescriptor`. An unknown parent returns `{ entries: [], parentAvailable: false }`. A known parent with no `subagents` provider is `subagent/projections-unavailable`. A fork `parentSession` is not treated as a subagent parent. `parentAvailable` is whether that parent already has a live owner. A cold non-subagent invocation root may be resumed so `list` can run. A walk that cannot reach a non-subagent header does not resume that subagent as a root; the catalog then uses stored headers only.

`subagents/prompt` requires `mode: 'continuable'`, a live direct parent, and `delivery: 'queue' | 'steer'`. Both delivery values call `NativeSubagentOperations.sendMessage`, which admits the adjacent next-step message and returns `{ messageId }` without waiting for the child turn. Images pass through `attachments.admitPromptContent`. `clientTimeZone` is checked with `canonicalClientTimeZone` and is not stored.

`subagents/interruptByParent` requires `mode: 'continuable'`. It calls `subagents.interrupt` on the live direct parent, or else the live invocation-root ancestor, and it never calls `session/cancel`. It returns `{ accepted: true }` when that signal is issued, or when the child is missing or has no live owner. A live child with no live ancestor is `subagent/parent-unavailable`. Missing `subagents` is `subagent/projections-unavailable`. Engine text `interrupt requires a live ancestor` is `subagent/unauthorized`. A parent, workspace, or descriptor mismatch is `subagent/unauthorized`.

`session/history` with `{ sessionId }` is unchanged, including a raw child id. `{ address: { kind: 'subagent', parentSessionId, childSessionId, mode } }` is dispatched first and returns the same history fields after the parent, workspace, and descriptor checks. `POST /api/native-session/follow` is unchanged. `POST /api/native-session/subagent-follow` follows that addressed child and does not acquire the parent turn.

Wire failures use fixed messages. Details may contain session ids and catalog reasons. They do not contain engine text, filesystem paths, or config secrets. `settings/describe`, `settings/open-document`, `session/files/*`, files follow, and durable tool call and result events are unchanged.

This Host behavior follows the Web address and continuation rules in [Web subagent conversations](2026-07-27-web-subagent-conversations.md), the current-turn interrupt rule in [continuable subagent interrupt](2026-08-06-continuable-subagent-interrupt.md), and the remaining product gaps in [Desktop-only retires the browser Web deployment](../architecture/2026-11-21-desktop-only-retires-browser-web.md).

## Alternatives considered

**Reimplement seed cutting and catalog projection in the Host.** The Engine fork and `NativeSubagentOperations` already persist the destination, reject an open source turn, and admit continuations. A second implementation would drift from those rules.

**Put the subagent address on `POST /api/native-session/follow`.** Root callers post a session id and an admission id. An extra address field on that route can change rejection of ordinary bodies. A sibling route keeps the existing follow request unchanged.

**Interrupt through `session/cancel`.** That route cancels the root turn. A child interrupt must not abort the parent.

**Call Cordis `listChildren` and `catalogView`.** Those services are outside the Native package graph. The Native Host uses `NativeSubagentOperations`.

**Require the client to supply the destination Session id.** The legacy Web Host mints the id. The Engine fork already requires the caller to pass `id`, so the Host mints it and the wire result stays `{ sessionId }`.

## Consequences

Root history and follow callers keep their current requests and responses. Queue and steer are both accepted on the wire, and Native admission is always the next-step inbox; there is no separate Native queue inbox for this prompt. An interrupt acceptance means the Host issued the Engine signal or treated the child as missing or not live. A live child that cannot be signaled is a fixed error, not acceptance. Acceptance does not wait for the child turn to stop, and it does not cancel the parent.

The skill tool row, settings document UI, and right-sidebar multi-document tabs remain open. The Desktop-only note still owns that product scope. `profile: web` snapshots stay on the legacy composition until those UI gaps close.

## Verification

`rsh/Programs/Web/api/native-web-session-controller/tests/subagent.host.spec.ts` has four tests: fork failure hiding, direct-child catalog diagnostics, prompt plus interrupt without parent cancel, and addressed history and follow beside unchanged `history(sessionId)`. The existing real-browser RPC test asserts that an empty `POST /api/native-session/subagent-follow` is rejected. That spec covers every statement, branch, function, and line in `subagent-host.ts`.
