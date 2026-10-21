# Agent Note: Native worker-thread code runtime

Status: implemented

English | [中文](2026-09-23-native-code-runtime.zh.md)

## Problem

Native profiles could own Agents, tool approval, and jobs, but they could not execute model-written TypeScript without importing the Cordis code-runtime service, Context lifecycle, validation dependencies, or its profile assembly. The existing worker-thread implementation already had tested resource containment and JSON port behavior that should remain compatible for program authors.

## Decision

`@deepseek-ai/dsh-native-code-runtime` is a framework-free Host Provider for `codeRuntime`. It preserves the existing request/result vocabulary and worker execution behavior while moving the portable type vocabulary and worker protocol into the native package. The provider resolves four explicit resource limits before activation, owns `dispose()` through `NativeContext.own()`, and terminates every live worker during Host teardown.

The package does not import a Cordis runtime or adapter. `dsh-native-headless` consumes the optional service as a fixed `run_code` operation, supplies no host bindings, and writes the bounded JSON result as its ordinary tool result before the next model request. Other native applications must supply their own bindings and decide their own Session projection. The Cordis worker-thread package remains unchanged, so existing Cordis profiles retain their current seam implementation until a later profile-default migration.

## Alternatives considered

**Wrap the Cordis worker-thread service:** This would make native profile execution depend on a second lifecycle and framework scope while still leaving provider cleanup split across runtimes.

**Switch the existing package in place:** This would change the public behavior and dependency graph of released Cordis profiles before their consumers had migrated.

**Delay all code execution:** Native applications then could not adopt the established program and binding vocabulary while the rest of the runtime migration proceeds.

## Consequences

Native profiles now have a worker-thread code provider with the same portable source constraints, result taxonomy, empty environment, resource caps, and hard worker termination behavior as the established implementation. It is containment rather than a sandbox and it does not stop child OS processes. P5 must decide whether completed native consumers make this provider a profile default; this P4 change intentionally leaves defaults untouched.

## Verification

Native Host tests validate manifest wiring, empty-config defaults, configuration rejection, a real worker binding round trip, output ordering, abort reporting, Host cleanup, and refusal after disposal. The native headless integration test runs `run_code`, proves the schema is model-visible, and verifies its ordered Session tool-result projection.
