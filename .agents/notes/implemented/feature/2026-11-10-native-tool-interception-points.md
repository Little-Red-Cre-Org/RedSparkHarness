# Agent Note: Native tool interception points

Status: implemented

English | [中文](2026-11-10-native-tool-interception-points.zh.md)

## Problem

The Native runtime had no per-call decision point for tools. A policy could classify concurrency before dispatch (`executionMode`), wrap the body (`aroundExecution`), transform a completed result (`postResult`), observe settlement (`onResult`, `onSettlement`), and deny synchronously before approval (`guard`). None of those is the compatibility `tools/pre-execute` point: a denial could not carry a model-visible reason and a recorded durable outcome, an approval could only be declared statically by the contribution itself, and no point ran *after* the body but *before* result policies with the authority to turn a successful call into recorded corrective feedback.

That gap blocked the hook bridges. Claude Code's `PreToolUse` maps to `tools/pre-execute` and its `PostToolUse` to `tools/post-execute`; on the Native side the tool call pipeline is an inline sequence inside `native-headless`'s step loop, and `native-tools` ordered dispatch only schedules bodies. The two parts of the compatibility vocabulary a hook needs — allow/deny/ask before, pass/block with context after — had no Native counterpart, so a bridge could not be written without a second, divergent decision path.

The interception project the [compatibility interception note](2026-06-30-interception-extension-points.md) chose deliberately excluded argument rewriting from pre-tool policy: history, audit and UI all read the arguments logged before execution. Native keeps that rule. The recorded `tool/call` arguments never change; a pre-tool decision may replace only the parsed arguments the body receives, which the Native application validates against the same schema before the body runs.

## Decision

`@redspark/rsh-native-tools` owns two ordered interception points on the scoped registry, beside the execution and result policies it already owns.

`interceptBeforeCall(interceptor, scope?)` answers one call before its body: `allow` (optionally with replacement arguments), `deny` with a reason, or `ask` with an optional reason. `interceptAfterCall(interceptor, scope?)` answers one completed body result: `pass`, or `block` with corrective feedback; either answer may attach sourced user messages.

Both are waterfalls in the same sense as the rest of the registry: a listener either delegates with `next()` or answers on its own, and the first listener that answers ends the chain. Delegated branches are awaited for quiescence, and the listener's own answer stays authoritative — the semantics `postResult` already uses, because a hook may translate a downstream failure (a timeout, a refusal) into its own answer.

The points run inside the registry's preparation and result pipeline, which is where every Registry-served call passes:

1. Before preparation validates arguments and reaches guards, the pre point answers. `deny` and a refused `ask` become a thrown `HarnessError` carrying the decision's reason, so the application records the same shape of error result it records for a guard denial and the body never runs. `ask` is resolved through the invocation's existing approval authority, and a closed outcome names the reason the model reads: a human said no, the question was withdrawn, or no channel exists to ask it.
2. A replacement argument value is snapshotted as lossless JSON, frozen, and becomes the invocation's arguments for validation, guards, the approval scope key, and the body. An interceptor that supplies a non-lossless value fails loud.
3. After the body settles, the post point answers before result policies. A `block` replaces the outcome with an `isError` result whose content is the feedback, and — like `tools/post-execute` — discards the body's own deferred contexts, exposing only the ones the blocking decision supplied. A `pass` keeps the body result and appends decision contexts after the result's own contexts.

The Native application asks the same two points for its own builtin tools (`read_file`, `write_file`, `run_code`), which have no registry registration to reach them through. A policy therefore states one rule per tool name rather than one rule per transport, and a hook that installs only the Registry-side points still governs every call the model makes.

`NativeToolExecution` gained an optional `turn`, so a decision can name the open turn it answers for; a call outside a recorded turn omits it rather than inventing `0`.

## Consequences

A bridge that maps an external hook protocol onto these points records `hook/*` events, receives a typed decision vocabulary, and needs no second pipeline. The pre point cannot rewrite the logged call, which keeps the log, the auditor and the UI agreeing about what ran; a reader that needs the effective arguments reads them from the invocation the registry sealed.

The interception authorities stay separated: the pre point may deny, ask or rewrite arguments; the post point may accept or block and add context; guards remain a monotonic, synchronous, deny-only invariant after the pre point; result policies still transform what the post point accepted. No point can force-allow an operation a later invariant forbids.

The registry published the new points as methods on its existing class, so the [native package policy](../../../../rsh/Scripts/native-package-policy.ts) needs no new entry or subpath. `pnpm run typecheck`, `pnpm run lint:contracts-ready`, the native-tools unit suite, the native-headless unit suite, and the native-headless recorded-session suite cover the behaviour.

## Alternatives considered

- **Reuse `aroundExecution` for both decisions.** Rejected: a surrounding policy may only replace an outcome after delegating, so a hook that denies cannot prevent the body from running, and a hook that blocks cannot make the model read its feedback instead of the output. Both are the point of the protocol.
- **Add the interception points to `native-headless` rather than `native-tools`.** Rejected: the decisions belong to the registry that owns validation, approval, guards and result processing, and programs dispatching nested PTC calls reach the same registry. A policy installed once must cover them.
- **Let a pre-tool decision rewrite the recorded `tool/call` arguments.** Rejected for the reason the compatibility note gives: history and presentation were already written from the logged text.
- **Answer only Registry-served calls.** Rejected: the hook protocol's matcher addresses tool *names*. Leaving `read_file`/`write_file`/`run_code` outside the points would make a `PreToolUse` matcher silently inapplicable to a third of the catalog.
