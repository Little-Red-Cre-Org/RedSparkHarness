# Agent Note: Native children record delegated policy

Status: implemented

English | [中文](2026-11-15-native-delegated-policy.zh.md)

## Problem

Cordis pins a delegated child's approval to `never` whenever approval is composed, and copies only the parent's explicit sandbox override. Native children did not record that pin. A read-only parent could delegate a child whose log never showed the fixed sandbox mode or the closed approval policy.

## Decision

`captureDelegatedPolicy` reads the parent before the child's first await. The sandbox value comes from `explicitSandboxMode`, the latest logged `sandbox/mode` kept by native sandbox policy. It is omitted when the parent never logged one. Approval is `approval/policy` `never` with `source: 'delegation'` only when that turn's `delegationAuthority.approvalRequired` is true. Native headless sets that flag when the approval service is installed.

One-shot children write both events from `initialize`, after the descriptor. Continuable children write them during maintenance, after the descriptor and before the inbox message. Native headless renders the runtime-context approval sentence from the latest `approval/policy` event on that Session, then from the installed approval policy. A child pin therefore tells the model that prompts are disabled even when the deployment policy is `ask`.

Shipped `native-sdk` does not install approval. The continuable inheritance replay installs `@redspark/rsh-native-approval` with `ask` because the recorded Cordis sdk bundle composes approval. The Cordis rule is [approval pinned never](../feature/2026-08-10-subagent-approval-pinned-never.md).

## Alternatives considered

**Pin approval on every Native child.** Rejected. A deployment without the approval service has no approval authority to close, and writing `never` would invent a policy the parent does not enforce.

**Copy the deployment sandbox mode when the parent log has no `sandbox/mode`.** Rejected. Cordis captures only an explicit Session override. The deployment default remains the child resolver's fallback when no event exists.

## Consequences

Exact child logs gain the pin only when the parent turn has approval authority. `snapshots/native-sdk/text-turn` installs approval and now records the pin and the disabled-prompt sentence. `snapshots/native-headless/workflow-native` disables approval, so its child logs stay unchanged. Profiles without approval, including shipped `native-sdk`, do not grow an `approval/policy` event. A Session approval override changes the next runtime-context snapshot.
