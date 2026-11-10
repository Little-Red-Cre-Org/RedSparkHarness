# Agent Note: A Native present tool

Status: implemented

English | [中文](2026-11-11-native-present-tool.zh.md)

## Problem

The `present` tool lets a Session declare finished files as deliverables: the model calls it after writing an output, and the delivery is recorded so a host can offer the file without copying it. Its only implementation was the Cordis plugin in `@redspark/rsh-tool-present`, which registers through `ctx.tools.register` and reads `sessionProjections.stateOf(session, 'turnBoundary')`.

A Native profile composes no such row, and no Native package implemented it. Searching `src` for a `present` tool registration and every native test profile for the row both returned nothing, so a Native Session could not declare a deliverable at all. This was the last package on the measured list that genuinely lacked a Native form.

## Decision

`@redspark/rsh-tool-present` publishes a `./native` entry beside its Cordis entry, registered in the three `native-package-policy.ts` tables as a mixed package. Both halves share `types.ts`, which declares the `deliverables/presented` event through declaration merging on the Session event map — the Native session already lists that type in `known-event-types.ts`, so no new event was needed.

The contribution reads two facts the Native tool execution already supplies. `NativeToolExecution.turn` names the open turn, replacing the `turnBoundary` projection read. `NativeToolExecution.appendEvent` records the delivery: it appends to the Session and persists, so the event joins the caller's pending batch instead of splitting it.

Validation matches the Cordis body: each path must be an existing regular file, checked through `fs.lstat` and `fs.stat` before anything is recorded.

## Alternatives considered

**Reuse the Cordis plugin through the compatibility bridge.** Rejected: the bridge exists to adapt Cordis for profiles that already run Cordis. A Native profile has no Loader and no `ctx.tools`, so there is nothing for the bridge to adapt into.

**Read the turn from a session projection.** Rejected: `NativeToolExecution.turn` is the open turn the registry already resolved for this exact invocation, while a projection read would reintroduce the ordering dependency the Native runtime removed.

**Record the delivery in the tool result only.** Rejected: the protocol is that anything model-visible is logged. A delivery a host renders must be reconstructable from the Session log, and the tool result alone does not survive replay as a queryable fact.

## Consequences

A Native profile can now compose `present` and record durable deliveries. The Cordis half stays until `base` retires, because `base` and the Python SDK runtime still import it.

The package needs a package-local `tsdown.config.ts`. The repository tsdown entries omit `native`, so without it the build produced only `lib/types/index.js` and `lint` failed on the missing entry — the same requirement every package with a Native entry has.

The earlier record that this port needed "two seams that do not exist" was wrong: `turn` and `appendEvent` already existed on the execution. The cost was reading the contribution API correctly, not adding runtime capability.
