# Agent Note: Native Web reads and changes composer modes and permissions

Status: implemented

English | [中文](2026-10-12-native-web-composer-controls.zh.md)

## Problem

The Native Web composer needs current values and available choices for agent mode, plan mode and standing permission policy. The Host already owns agent-preset selection, the plan-mode state machine and durable permission events, but the selected Native Session Consumer exposes no combined reads and only the existing agent-preset mutation.

## Decision

The authenticated Native Session API in [the Host controller](../../../../rsh/Programs/Web/api/native-web-session-controller/src/native.ts) exposes `session/mode-controls`, `session/select-plan-mode`, `session/permission-controls` and `session/select-permission`. The Cordis-free Client in [native-session](../../../../rsh/Programs/Web/client/native-session/src/native.ts) exposes `modeControls`, `selectPlanMode`, `permissionControls` and `selectPermissionPreset`; it decodes each reply before returning it.

Mode reads use the exact root Session owner and the complete event log to fold the selected preset, its durable revision and the permanent first-turn lock. The Host advertises installed presets only. Mode changes continue through `session/select-preset` and `rootExecution.selectPreset`, as described by the [Native Web model-controls decision](../architecture/2026-10-05-native-web-model-controls.md); the root executor owns revision comparison, the blank-session rule and Agent epoch replacement. Plan-mode reads include the installed Provider's logged and pending state. Plan-mode changes call the Provider's existing selection state machine in [plan-mode](../../../../rsh/Modules/Official/plan/plan-mode/src/native.ts), which records `plan/mode` immediately while idle or holds the requested value until the next accepted step; see the [shared plan-mode decision](../architecture/2026-10-08-native-session-title-and-plan-mode.md).

Permission reads and writes use `NativePermissionPresetOperations` in [permission-presets](../../../../rsh/Modules/Official/interaction/permission-presets/src/native.ts) on the exact root owner. The Provider resolves the effective choice from `permission/preset`, `sandbox/mode` and `approval/policy` events over the selected deployment defaults. A matching configured preset is current; an unmatched policy is reported as the current-only `custom` option. Selection writes through the same existing events. It never consumes or answers a pending one-shot approval.

The Host keeps plan-mode and permission Providers optional. A missing plan-mode Provider returns `available: false`; a missing permission Provider returns an unavailable value with no current choice or options. A missing preset Registry leaves the current mode facts readable but advertises no selectable presets. Mutation failures use the existing Native Session RPC error envelope.

The Native application renders these Host reads in the composer. Its mode and permission controls use the shared select primitive; the Plan toggle shows committed and pending state. The controller refreshes both session controls on Session selection and turn settlement, then refreshes the affected control after a mutation, including failure. See the [native application](../../../../rsh/Programs/Web/client/native-application/README.md).

## Alternatives considered

**Add another composer settings store.** This would duplicate the durable Session authorities and make restored Sessions disagree with the Host-owned preset, plan-mode and permission event folds.

**Use one-shot approval answers for standing permission changes.** Approval answers authorize one pending operation and are bound to its prompt identity; they do not represent a Session's continuing sandbox and approval policy.

**Reimplement preset or plan selection in the Web controller.** The existing root executor owns preset locking and epoch replacement, and the plan-mode Provider owns pending-step timing and narration. Reusing these authorities preserves their existing behavior.

## Consequences

The Native Client and application render these Host-owned values without a second settings or Session cache. The mode selector uses Host-installed choices and their durable revision, and remains locked after the first turn. Plan mode exposes committed and pending state, including changes queued for the next accepted step. Permission choices appear only when the permission Provider is available and do not replace pending human approvals. The shipped native-web profile leaves optional plan-mode and permission Providers uninstalled; profiles that add them expose those choices in the composer.

## Verification

The authenticated Native Web host scenario checks current and available modes, changes plan mode through both committed states, reads and changes permission presets, and changes an agent preset through the existing revision-checked route. The Native application test checks the mode revision, plan-mode result and permission mutation. These checks exercise the real providers and Session executor rather than a parallel store.
