---
description: "Native profiles can accept reversible tool contributions while the application keeps the only durable Session result record."
kind: "package-reference"
---

# @redspark/rsh-native-tools

English | [中文](README.zh.md)

## Summary

`dsh-native-tools` adds scoped model tools and typed program bindings to a native profile. Contributions share validation, approval, cancellation and result processing. The application keeps the only Session writer and decides when a completed result becomes durable.

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Configuration

The `./native` entry accepts `mode: native | ptc | both` (default `both`). Native mode hides `run_code` from model calls, PTC mode exposes only that transport and requires a visible registered `run_code`, and both mode exposes all visible tools. A descendant scope shadows that selection with `presentAs(mode, scope)`; the nearest declaration wins, and a second declaration in the same scope fails. Program bindings retain the same scoped capabilities in every mode. Unknown configuration fields fail activation.

Value contributions declare an output schema; the registry captures it, validates detached JSON and renders the canonical result. Scoped restrictions and guards run before approval and again before executor entry. Removing a contribution closes admission, cancels captured calls and drains their actual work before its disposer resolves. Result policies must delegate exactly once; finalizers finish before the application records the result. Only `acceptResult()` notifies result observers after that record is accepted. Sourced additional contexts remain separate from canonical JSON.

An operation owner may pass `sessionContext: { cwdKey, targetKey }` to ordinary `authorize` only when those identities describe its effective cwd and exact resolved execution target. The registry binds the frozen validated parameters; the application owns matching and persistence. Missing or incomplete context cannot advertise remembered approval. `requestApproval` always discards reusable context for one-call sandbox escalation, and delegated calls do not receive a reusable candidate.

`captureModelSnapshot()` and `captureProgramSnapshot()` bind schemas and execution authority to exact registrations. `includesRegistration()` tests the captured disposer identity. Consumers use the snapshots that supplied the model schemas or PTC bindings for visibility and execution; a same-name replacement is not the captured registration. An empty program snapshot is an explicit empty binding set, while an absent program snapshot means that execution has no captured PTC route.

An Engine external-operation invocation defers `acceptResult()` until its complete tool-result event is durable. After the broker also records the accepted settlement, `readAcceptedImages()` resolves image references from that exact result and its settlement contexts through the captured Native attachment service; it accepts no caller-supplied references and returns verified stored bytes.

`interceptBeforeCall(interceptor, scope?)` and `interceptAfterCall(interceptor, scope?)` install the two per-call decision points. Each is an ordered waterfall: a listener either delegates with `next()` or answers on its own, and the first listener that answers ends the chain. The pre-tool decision allows, denies with a reason, or asks the consuming application for a one-call approval, and an `allow` answer may replace the parsed arguments the body receives — the recorded `tool/call` arguments never change. The post-tool decision passes the body result or blocks it into a failure whose content is the corrective feedback. Either post-tool answer may attach sourced user messages, appended after the result's own contexts. A block discards the body's contexts, matching the compatibility `tools/post-execute` rule. The application asks these points for its own builtin tools too, so a policy states one rule per tool name rather than per transport.

A contribution may declare a positive `timeoutMs` body budget; the registry only records it. `aroundExecution(policy, scope?)` installs a policy around every body, outside result processing. The policy receives the frozen tool declaration and must call `next(signal?)` exactly once. A replacement signal is combined with the caller's signal, and the policy's own result is the outcome. Earlier registrations surround later ones. `onSettlement(policy, scope?)` installs a synchronous policy that sees each recorded result with frozen copies of its parsed arguments and may return only user messages. Applications call `settlementContexts()` once for each result they record, and PTC dispatch does the same for nested calls. These two hooks back the native timeout and repeat-call guards.

The pure `./types` and `./presentation` exports share durable PTC event payloads, generic call views and file diffs with Host and Client consumers. `./presentation` owns `GenericCallView`, `ToolCallKind` and `FileLocation`; compatibility Tools re-exports those declarations. The registry entry is Host-only. These declarations do not install a PTC executor or change Session event names or payload fields.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consuming native application. Selected schemas and rendered results reach the model; sourced additional contexts become separate logged messages.

#### KV Cache effect

The consuming application owns request-prefix changes from registered schemas.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The registry supplies PTC dispatch and TypeScript/Python binding renderers; an actual code-runtime Consumer and selected runtime Provider are separate installations.
- It does not open Session storage or add a second execution loop. The application owns durable event ordering and model requests.

No invariant companion is published because there is no independent observation of the owning application's durable result acceptance.

The framework-free `./presentation` export owns generic call views, search-card path and grouped-match result types, and file diffs. Compatibility Tools re-export these same types; native search results persist their bounded metadata with the authoritative Tool result.

<a id="dev-note"></a>
### Dev Note

None.
