# Agent Note: Native composes the standing policies into the runtime-context snapshot

Status: implemented

English | [中文](2026-11-09-native-runtime-context-snapshot.zh.md)

## Problem

A Cordis session reaches its model with one `user/message` runtime-context snapshot that states the standing file policy and approval policy. The snapshot is what stops a model from refusing work because it predicted a denial from the policy text alone, and it is the surface a recorded turn carries after its user message.

`native-headless` had no such message. `native-sandbox-policy` resolved a policy that the file and code tools enforced, and `native-approval` applied its policy before a protected operation, but neither reached the model as context. A Native session therefore ran under a policy the model could not read, and its recorded Sessions carried no snapshot where the Cordis ones did.

## Decision

`runTurn` resolves the standing policy through `this.sandboxPolicy?.resolve({ session })` and, when that service is installed, renders one `user/message` from `policySections`: a `sandbox:policy` section stating the resolved mode and, under `workspace-write`, the workspace root, plus an `approval:policy` section stating either the `ask` contract or the disabled-approval contract. The message carries the source `{ kind: 'plugin', plugin: '@redspark/rsh-system-prompt', form: 'snapshot', sections }` and prefixes its text with the same header `joinContextSections` produces, so a recorded Native turn and a recorded Cordis turn describe the policy the same way.

The snapshot is deduplicated against the text the model history still retains, not appended per step. `retainedRuntimeContext` reads the newest surviving surface node owned by this producer; a step appends only when the rendered text differs. That matches `RuntimeContextProjection.project` in `agent-loop`, which returns no commit for an unchanged snapshot, and it keeps a three-step turn from carrying three identical copies.

The wording is copied from the Cordis owners verbatim — `renderPolicyContext` in `sandbox-policy` and the `approval:policy` contribution in `compat-user-approval` — because the text is model-facing contract, not a Native invention.

## Alternatives considered

**Append the snapshot every step.** Rejected. It is simpler, but a recorded Native turn then carries one copy per step where Cordis carries one per policy change. Measured on the shipped corpus, that produced 2 additions in `claude-code` and 5 in `fs-sandbox-tool-round`, and the corpus records the opposite.

**Reuse the Cordis `systemPrompt` context contribution.** Rejected. That service is a Cordis plugin; the Native application composes no Cordis Context, which the corpus already asserts through a loader probe that throws on Context construction.

**Render only the sandbox section.** Rejected. An approval policy the model cannot read is the same defect as an unread file policy: the model cannot tell an operation that will be asked from one that will be rejected outright.

**Bound the workspace root out of the text.** Rejected. `workspace-write` is only meaningful with the root it grants, and the Cordis text states it.

## Consequences

A Native session now gives its model the same standing-policy context a Cordis session does, and `snapshots/native-headless/` records it: five scenarios gain the snapshot, and `ptc-jobs` gains two because its policy genuinely changes from `read-only` to `danger-full-access` between steps.

The snapshot embeds the workspace root as a JSON string, so those five owners now pass `cwdAliases: [JSON.stringify(workspace).slice(1, -1)]`, the same escaped-spelling alias the session suite adopted in [the JSON-escaped cwd note](../testing/2026-11-09-snapshot-cwd-json-escaped-alias.md). Without it the fixture would record the random per-run temporary directory.

A unit test pins the dedupe: three steps under one unchanged policy produce exactly one snapshot, and the test fails with three when the guard is removed. The Native application still composes no Cordis Context, and `approval` and `sandboxPolicy` remain optional rows — a profile that installs neither appends no snapshot.
