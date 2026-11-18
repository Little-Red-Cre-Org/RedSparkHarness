# Agent Note: Agent Teams gains a Native runtime

Status: implemented

English | [中文](2026-11-17-agent-teams-native-runtime.zh.md)

## Problem

Agent Teams was the one shipped capability whose only runtime was Cordis. `TeamService` extends `TypertRemoteService` and reads `ctx.sessionProjections`, `ctx.sessions`, and `ctx.subagents`; `tool-agent-team` registers its nine tools through the Cordis tool registry. A Cordis-free profile could not create a teammate, deliver a peer message, or expose the Team tool surface at all, so [retiring Cordis in five measured phases](../../proposed/architecture/2026-11-12-cordis-retirement-five-phases.md) could not close: deleting the runtime would delete a product feature.

The two experimental packages also split their behaviour across Cordis-shaped files. `roster.ts`, `mailbox.ts`, and `task-board.ts` imported the Cordis `Context` and `Agent` types even though their durable rules — reserved names, delivery de-duplication, task compare-and-set, teardown order — do not depend on either runtime.

## Decision

Both Team packages publish a Native entry. The runtime-neutral rules are shared owners; each runtime keeps a thin adapter for Session attachment and delivery authorization.

- `@redspark/rsh-experimental-agent-team/native` provides `agentTeams`. It requires `agents`, `activeSessions`, `sessionPersistence`, `sessionProjections`, and `subagents`, and declares no Cordis package.
- `@redspark/rsh-experimental-tool-agent-team/native` registers the same nine value tools and one collaboration prompt section into each active member's exact Agent scope. Membership is decided by `agentTeams.tryMembership`, so the tools exist only for the Lead and its teammates. It requires `agentTeams`, `agents`, `activeSessions`, `tools`, and `promptSections`.
- `journal-port.ts` defines `TeamJournalPort`; `journal.ts` and `native-journal.ts` implement it over the Cordis Session service and the Native active-owner writer. `task-board.ts`, `projection.ts`, `membership.ts`, and `session-message.ts` depend on that port plus injected `ownerOf`, `rootOf`, and `statusOf` lookups instead of either runtime's services.
- `roster.ts` and `native-roster.ts` are runtime adapters over the shared membership, provisioning, and teardown rules. `mailbox.ts` and `native-mailbox.ts` stay per-runtime because their delivery paths authorize different caller shapes: `Agent.steer()` on Cordis and the continuation owner's host-only Steer on Native.
- `membership.ts` owns the runtime-neutral membership rules: an exact live Agent, its root Session, and a durable roster row or implicit Lead identity. The Cordis `TeamService` keeps `extends TypertRemoteService` until Typert deletion; the Native service exposes the same operations as plain methods.
- `NativeSubagentRequest.id` becomes optional so the roster can reserve a durable child Session id before the provider starts it. The Cordis continuation path omits the field and keeps letting the provider choose.

### Package policy

Both directories join `mixedNativeEntryDirectories` in `native-package-policy.ts`: they ship a Cordis entry and a Native entry, so their Cordis-only peers stay optional. The Native graph admits its shared Session, LLM, and projection imports through `cordisOwnedNativeReferences`, which now covers both Cordis plugin hosts and durable vocabulary both runtime faces read. `agent-team` also splits its TypeScript solution into `tsconfig.host.json` and `tsconfig.client.json`, and downstream references point at the face they consume.

### Invariant companion

The Native face publishes no `./invariant`. The Cordis companion observes Cordis `session/event` dispatch; the Native journal reads authoritative state through the strict Team projection before every mutation, so a corrupt stream fails that read instead of passing unnoticed.

## Alternatives considered

**Run the Cordis Agent Teams plugin through the Cordis bridge from a Native row.** Rejected. The bridge dynamically imports `@redspark/cordis`, so every Native profile that mounted teams would keep the runtime this work exists to remove. It also leaves the tool installation and Typert Remote registration Cordis-shaped.

**Duplicate the durable rules inside the Native entry.** Rejected. Reserved names, delivery acknowledgement, task revisions, and teardown ordering are durable rules shared by both faces; copies would drift and only one would be exercised by each face's tests. The task board, projection, membership resolver, and Session-message acceptance check are therefore shared; roster and mailbox keep one adapter per runtime because their Session and delivery operations differ.

**Move only `tool-agent-team` to Native.** Rejected. The tools call `ctx.agentTeams`; without a Native provider there is no service to call, and the tools would fail at their first request.

**Move the Web UI to Native and delete the Cordis half now.** Rejected for this change. The Web Team panel consumes the Typert Remote methods; that transport retires only with [Typert](../../proposed/architecture/2026-11-17-typert-retires-with-cordis.md). The Native runtime is the prerequisite, not the deletion.

## Consequences

A Cordis-free profile can now run the full Team feature: spawn a teammate, exchange durable messages, coordinate the task board, and wait or interrupt. `native-neutral` profiles exercise the same durable JSONL events, so a Team recorded by one face replays in the other.

Cordis still hosts the Web Team panel and its Remote methods until Typert deletion. Two entries therefore remain to be kept in step: a new Team operation must be added to the shared domain owner and wired in both faces, and only the Cordis face publishes Typert methods.

The tools still reserve the legacy subagent tool names, so a profile that mounts both the Team tools and the legacy subagent controls must disable one set. The Native face keeps the same fixed policy text and the same Lead-only restrictions as the Cordis face.
