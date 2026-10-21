# Agent Note: Native ACP Session carrier

Status: implemented

English | [中文](2026-10-05-native-acp-session-carrier.zh.md)

## Problem

The explicit `native-acp` profile must provide standard ACP transport while the Engine remains the only Agent, Session writer, and model-turn owner. Its declared installation requirements must cover every Engine operation the carrier uses before a Session becomes available.

## Decision

The native ACP application uses the maintained ACP SDK for wire validation and stdio framing and the shared `native-headless` executor for model, Agent, tool, and Session work. The host installation requires the native `activeSessions` Provider because `session/new` creates an empty durable Session through Engine root maintenance before acknowledging it. Installation planning rejects the carrier before activation when that Provider is absent; the carrier does not create a second persistence or Session writer path.

Each ACP Session owns an Engine executor, a branded route, a cancellation controller, and its protocol resources. Root execution resolves the exact attached root Agent and Session before dispatching through that route; a fresh Engine Session identity may differ from its ACP wire id. Admission rejects foreign, delegated, released, and closing owners. Exact-owner `capture` and `cancel` remain available while an owner is closing so cleanup can cancel and drain accepted work before Engine detachment. The required `releaseIdle` operation delegates through the selected route, while the Engine accepts retirement only for a settled owner on an admitted dynamic Workspace route; ACP's per-Session base route is not such a route. The optional `createWorkspaceRoute` capability is not exposed because this profile does not configure dynamic Workspace admission. Persistence retains the durable Session log after the live executor closes.

The carrier accepts standard text and image prompts, declared model controls, stdio and Streamable HTTP MCP tool connections, and permission requests. Model selection and permission outcomes stay attached to the exact Session owner. The compatibility `acp` profile remains the default composition; the `native-acp` profile is selected explicitly.

Input EOF and Host cancellation stop admission, cancel accepted work, and drain model initialization, permission requests, protocol resources, and executor teardown. Only the exact reason from an aborted execution signal maps to an ACP cancelled response; cleanup failures and unrelated execution errors remain protocol errors. The native carrier does not expose ACP question requests, attachment presentation, MCP resources or prompts, audio or embedded-context input, or a shutdown request. Dynamic workspace selection is not enabled by this profile; standard `session/new` and `session/resume` select and validate the Session workspace.

## Alternatives considered

**A protocol-owned Agent loop or Session writer.** Rejected because it would duplicate the Engine's execution admission, durable writer, and owner lifecycle.

**Leave `activeSessions` optional and create empty Sessions through persistence directly.** Rejected because every creation must follow Engine root maintenance; a separate persistence path would violate the single Session owner.

**Advertise complete ACP parity.** Rejected because unsupported interaction and presentation channels would fail after clients relied on their capability declaration. The native profile remains explicit and advertises only its supported input.

## Consequences

ACP clients can create and operate durable native Sessions through the supported launcher without booting Cordis. The protocol Session id and the Engine root Session id remain distinct identities connected by the owned route. Existing lifecycle coverage exercises the built launcher with a local controlled model server and the native Engine composition with deterministic adapters; it proves protocol and lifecycle behavior, not authenticated provider inference. The active-session planning regression proves a missing required Provider is rejected before activation.
