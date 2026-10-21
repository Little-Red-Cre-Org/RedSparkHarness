# Agent Note: Native worker-thread code runtime

Status: implemented

English | [中文](2026-09-23-native-code-runtime.zh.md)

## Problem

Native profiles could own Agents, tool approval, and jobs, but they could not execute model-written TypeScript without importing the Cordis code-runtime service, Context lifecycle, validation dependencies, or its profile assembly. The existing worker-thread implementation already had tested resource containment and JSON port behavior that should remain compatible for program authors.

## Decision

`@deepseek-ai/dsh-code-runtime-definition` owns the portable `CodeRunRequest`/result vocabulary and `CodeRuntimeDefinition`; `NativeCodeRunRequest` carries the exact live Native Session as host-side policy context and adds the native-only stop callback used to cancel caller-owned bindings. `@deepseek-ai/dsh-native-code-runtime` is the framework-free Host worker Provider for `codeRuntime`; it does not serialize the Session or enforce its file policy. `@deepseek-ai/dsh-code-runtime-process-sandbox` is the confined Host Provider: it resolves the effective mode and workspace through `NativeSandboxPolicy.resolve({ session })`, then passes the same policy to process confinement and uses its root as child `cwd`. It supports confined `read-only` and `workspace-write` Sessions and rejects effective `danger-full-access`, which needs a separately selected unconfined Provider. The Cordis `dsh-code-runtime` adapter remains under `rsh/Compatibility/DSH/bridge/compat-code-runtime` and implements the shared Definition without the native-only Session or stop callback.

The package does not import a Cordis runtime or adapter. `dsh-native-headless` passes the current Session to the selected Provider for each fixed `run_code` operation, supplies no host bindings, and writes the bounded JSON result as its ordinary tool result before the next model request. When the Session policy is restricted, its builtin and PTC Consumers reject the unconfined worker Provider; the process Provider applies that Session policy. Other native applications must supply their own bindings and decide their own Session projection. The Cordis worker-thread package remains unchanged, so existing Cordis profiles retain their current seam implementation until a later profile-default migration.

## Alternatives considered

**Wrap the Cordis worker-thread service:** This would make native profile execution depend on a second lifecycle and framework scope while still leaving provider cleanup split across runtimes.

**Switch the existing package in place:** This would change the public behavior and dependency graph of released Cordis profiles before their consumers had migrated.

**Delay all code execution:** Native applications then could not adopt the established program and binding vocabulary while the rest of the runtime migration proceeds.

## Consequences

Native profiles now have a worker-thread code provider with the same portable source constraints, result taxonomy, empty environment, resource caps, and hard worker termination behavior as the established implementation. It is containment rather than a sandbox and it does not stop child OS processes. A confined composition must select the process Provider, which consumes the current Session's policy; a worker Provider cannot satisfy that contract. P5 must decide whether completed native consumers make a provider a profile default; this P4 change intentionally leaves defaults untouched.

## Verification

Native Host tests validate manifest wiring, empty-config defaults, configuration rejection, a real worker binding round trip, output ordering, abort reporting, Host cleanup, and refusal after disposal. The native headless integration tests prove builtin and PTC Consumers pass the current Session, reject restricted Session policy with a worker Provider, and preserve the ordered Session tool-result projection. Parameterized process Provider tests verify that Session `read-only` and `workspace-write` overrides and the workspace root reach both `ProcessSandbox.confine()` and child `cwd`, while `danger-full-access` is rejected before confinement or spawn; these seam tests do not claim an OS escape test.
