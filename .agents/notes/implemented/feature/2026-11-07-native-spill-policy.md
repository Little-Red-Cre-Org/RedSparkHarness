# Agent Note: The spill policy runs on the Native tool registry

Status: implemented

English | [中文](2026-11-07-native-spill-policy.zh.md)

## Problem

The shipped Native composition installed `spill-local` — the spill store — and nothing that used it. The Cordis base bundle pairs that store with `spill-policy`, which bounds an oversized plain-text tool result to a preview plus a locator; the Native composition had no such row, so a Native session pasted whole tool outputs into the model's context while a Cordis session did not. The store was dead weight.

## Decision

The Native tool registry exposes the same two extension points the Cordis one does, so the port keeps the policy's decisions verbatim and differs only in how they are reached:

| Cordis | Native |
|---|---|
| `ctx.on('tools/post-execute', …, { prepend: true })` | `tools.postResult(policy)` |
| `ctx.on('tools/ptc-dispatch-log', …, { prepend: true })` | `tools.postPtcDispatchLog(policy)` |
| `exec.agent?.session.header.id` | `call.session.header.id` |
| `ctx.get('spillStore')` | `context.optional('spillStore')` |
| `decision.kind !== 'accept'` | the selected result is already the accepted one |

The two Native signatures differ in ways that matter and are not cosmetic: the log policy receives the original result and a cancellation signal of its own, and returns the recorded `{ content, isError }` rather than a content array, because a dispatch log also records whether the sub-call failed. `saveText` likewise takes the call's signal, so a cancelled invocation stops its write.

Everything the Cordis policy decides is preserved, because each is a rule rather than an implementation detail:

- An omitted cap registers no policy at all.
- A cap that is not a non-negative integer fails at load, never per call — the retainer's budget assertion would otherwise throw inside every oversized call and turn a successful tool result into an error.
- The notice's byte cost is reserved inside the cap, priced at the worst-case omission count so the reservation upper-bounds the real one.
- When the notice alone would exceed the cap there is no within-cap replacement, so the original content is kept.
- The model-facing arm skips `read` and nested calls; the log arm bounds both, because a log copy is not model context and `read` is exactly the tool that produces huge logs.
- Every failure — no Session owner, no store, a throwing store — keeps the original inline content.

## Alternatives considered

**Leave the policy Cordis-only and delete the store row.** Rejected: the store stays useful only through a policy, and deleting the row would remove context bounding from Native sessions rather than porting it.

**Write a Native-specific bounding mechanism.** Rejected: `TextRetainer` and `formatSpillNotice` are already shared, and a second mechanism would let the two runtimes truncate differently — the notice spelling is persisted and recognised by `notice.ts`.

## Consequences

- A Native session bounds an oversized plain-text tool result the same way a Cordis session does, at the same 50000-byte cap.
- The store row now has a consumer in the Native composition.
- Coverage: `tests/native.client.spec.ts` pins the registration decisions (omitted cap, refused cap), and the eight model-facing rules plus both log-arm cases. Removing the `read` skip, the cap invariant, and the store-failure guard each turned exactly its own case red.
