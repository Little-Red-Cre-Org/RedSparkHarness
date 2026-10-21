---
description: "Share native approval contracts and Cordis-free legacy audit types between Providers and Consumers."
kind: "package-library"
---

# @deepseek-ai/dsh-approval-definition

English | [中文](README.zh.md)

## Summary

This package lets native and Compatibility consumers share approval identifiers, outcomes, and service operations. Native callers use the root entry; Cordis callers use `/legacy` and provide their actual owner type, such as `Agent`. The package defines contracts and Session policy helpers but does not dispatch answerers or own an application Session.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>

## Use this package

### When to use it

Native approval Providers and applications import the root service contract. `compat-user-approval` and `dsh-tools` import `/legacy`; their Cordis-facing type specializes `ApprovalServiceDefinition<Agent>` so the live Agent, its Session, and its scoped injection remain available to the implementation.

### Entry point

The root and legacy entries keep `native-approval/*` records separate from the compatibility `approval/*` records. A caller must use the contract for its selected Provider; this package does not convert one history into the other.

```ts
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalServiceDefinition } from '@deepseek-ai/dsh-approval-definition/legacy'

type CordisApproval = ApprovalServiceDefinition<Agent>
```

The compatibility bridge implements this specialized type with the original live Agent object.

## Implementation

The root entry declares native request and answerer operations. The `/legacy` entry declares the compatibility request and outcome types, the generic Agent owner parameter, and helpers that fold or append policy events on the exact Cordis-free Session object. Cordis dispatch and model-context updates belong to `compat-user-approval`; native Session writes and tool-result projection belong to the selected native application.

Both entries import Session declarations through `dsh-session/native` and `dsh-session/types`, not the Cordis SessionStore entry. The package publishes no `./invariant` companion because its brands and policy helpers own no independent registry or state; compatibility audit-pair validation remains with its Provider.

## Further Exploration

- [Approval subsystem](../../../Docs/subsystems/approval.md)
- [Native approval Provider](../../../Modules/Official/interaction/native-approval/README.md)
- [Cordis approval bridge](../../../Compatibility/DSH/bridge/compat-user-approval/README.md)
- [Approval ownership decision](../../../../.agents/notes/implemented/architecture/2026-09-23-native-tool-approval.md)

No runtime invariant companion is published because this package stores no independent approval state; the selected Provider owns audit-pair validation and Session owns durable event ordering.

## Model Experience

None, as approval contracts and policy helpers do not construct model requests.

#### KV Cache effect

The package does not add or reorder model request content.

## Known Limitations and Deferred Work

- The package does not implement answerer dispatch, UI presentation, or application Session ownership; select the appropriate native or Compatibility Provider.

<a id="dev-note"></a>

### Dev Note

The native and legacy approval contracts intentionally retain separate event names and projection rules.
