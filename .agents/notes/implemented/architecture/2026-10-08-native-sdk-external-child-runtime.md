# Agent Note: Native SDK external child runtime

Status: implemented

English | [中文](2026-10-08-native-sdk-external-child-runtime.zh.md)

## Problem

The P4 external-child adapter needs the real SDK Session and turn protocol while preserving the selected Program as the only Agent, Session writer, launcher, and child-range owner. A Native Module cannot import a Program client to launch itself, and it must not reinterpret same-named custom tools as parent builtin permissions.

## Decision

The single TypeScript SDK protocol runtime and Session API live under `rsh/Engine/subagent/sdk-runtime`. Programs keep the public `@deepseek-ai/dsh-sdk-client` facade and its same-version `resolveDshLaunch` implementation. The opt-in Native profile contributes one fixed Program launcher capability. The Module asks that capability for one selected provider/model route; it receives no arbitrary executable, argv, profile, patch, or parent environment.

The profile loader derives the child provider map from the selected `pi-ai` installation after applying the user's profile overlays. The child adapter resolves only the selected profile's `apiKeyEnv` through the Host credentials service and sends only that key to the fixed child process. Stored OAuth and credential records are explicitly unsupported. The model catalog remains provider-owned.

When the same-version CLI has only its source entry, the SDK selects the Cordis source patch from the profile's validated runtime marker. The CLI's `nativeProfileTemplates` package metadata is the single shipped Native profile registry used by both the template writer and the SDK launcher; custom profile names follow their manifest marker.

Parent file grants originate from `NativeSessionDelegationAuthority.builtinToolNames`, which Native Headless builds separately from model-visible Plugin tools. Reads use the inherited Session cwd. A child receives the exact built-in `write_file` only when the parent snapshot grants it, approval is required, the parent policy has a resolved workspace-write root, and the selected `dsh-sdk` driver holds the callback bound to the live owner, epoch, and turn. The fixed private launcher adds the Native Approval `ask` provider only for that relay; otherwise the child profile has no approval provider. The SDK request carries operation, request, child Session, and tool-call identities. The existing parent approval authority alone writes durable asked/decided events, while the SDK transport only carries the question and decision. Cancellation, timeout, owner retirement, and close cancel the relay; revalidation after the await rejects a late result. The child process sandbox confines filesystem effects, the private DSH_HOME is removed after the managed range drains, and Windows enforcement is reported as partial where the backend says so.

## Consequences

- The Engine runtime is framework-neutral and contains the only SDK transport/session implementation; no Engine or Module edge points to Programs.
- Programs retain the supported default SDK launcher and the opt-in fixed native child launcher. Ordinary `native-sdk` composition is unchanged.
- The child gets only provenance-backed Headless builtin file tools. It supports parent-approved writes only through the exact parent's operation-bound approval relay; custom tool filtering, persona, and structured output remain unsupported.
- `maxTokens` keeps its per-request meaning. Native `maxSteps` is negotiated and clamped to the profile ceiling during the initialize handshake before readiness is published; the existing Headless loop enforces that limit when the subsequent child turn runs.

## Alternatives considered

- **Keep the protocol runtime inside Programs** — rejected because Engine and Native Module consumers would depend upward on the Program SDK client.
- **Add a child-only protocol client** — rejected because a second handshake and Session implementation could diverge from the public TypeScript SDK.
- **Let the Module choose an executable and argv** — rejected because the Program and Host must retain launch policy and process-range ownership.

## Validation boundary

Controlled model-server fixtures verify process launch, selected route inheritance, the real initialize handshake, the existing step-limit terminal event, cancellation/drain, and actual builtin file access. They do not establish live provider OAuth, dynamic catalog refresh, subscription login, or network inference.
