# Agent Note: Native compatibility uses Loader entries for selected Cordis plugins

Status: implemented

English | [中文](2026-10-06-native-compatibility-loader-entry-lifecycle.zh.md)

## Problem

The Host filesystem compatibility adapters need Loader-managed configuration updates and entry removal without replacing the Native installation or exposing stale native tools, prompt sections, or filesystem listeners during Cordis teardown.

## Decision

`compat-dsh-runtime` creates one Cordis Context owned by the selected Native installation, installs `RshPluginHost` and the vendored Loader, and mounts supported entries through that Loader. The support record pins Cordis 4.0.2, Loader 1.0.3, four filesystem DSH packages at 0.1.5-rc.2, and the shared `dsh-tools` and `dsh-system-prompt` Cordis plugins at 0.1.5-rc.2. DSH filesystem packages must match their installed name, version, runtime API, role, and capability metadata. The shared Cordis plugins have no `dsh.runtime` declaration; their names and versions are checked from installed manifests, their RSH adapter descriptors use API 1 with role `adapter` and capability `dsh-compatibility`, and startup requires their `tools` and `systemPrompt` services.

Loader entry configuration updates, enable, disable, and removal run through one serialized operation queue. Before each operation, registered Native participants withdraw their contributions and await admitted tool calls, prompt assembly, and event listeners. After the Loader settles, participants rebuild from current enabled entries and services. Failed activation attempts to remove its partial entry before the next queued operation runs; if a participant prevents cleanup, the failed mount stays tracked so its disposer can retry after the participant recovers. The native application continues to own Agent execution, tool/result logging, and Session persistence. `NativeHost.replace` replaces an installation after native profile changes; it is separate from Loader entry updates. Module-code HMR, arbitrary plugins, legacy application bundles, and Client compatibility remain unsupported.

## Alternatives considered

**Keep direct `Context.plugin()` mounts:** Rejected because a direct Fiber mount does not make the selected plugin a Loader entry with Loader configuration update and removal semantics.

**Replace the whole Native installation after every legacy configuration edit:** Rejected because Loader already owns Cordis entry configuration and lifecycle; restarting the Native installation would widen a local entry change into replacement of unrelated Native services.

**Claim module-code HMR from Loader configuration support:** Rejected because this composition registers inline supported entries and does not establish a watcher or module replacement contract for Native bridge code.

## Consequences

Selected Cordis entries can be updated and removed while the same Native Agent and Session authorities remain active. Tool schemas and prompt sections disappear before their entry changes, and their admitted calls and prompt assembly finish before Loader mutates the entry. The filesystem policy bridge drains its Native listeners before the policy entry changes. Live filesystem service proxies resolve the current Cordis provider after a configuration update and fail after disable or removal. Exact package pins limit accepted integration releases; an upgrade requires support-record changes and focused lifecycle verification.

## Verification

The focused Native bridge run covers startup rollback, participant activation failure and disposal retry, queued updates after failed activation, config updates, enable, disable, removal, tool-call and prompt-assembly draining, prompt and schema rebuilding, filesystem observation forwarding, and one durable tool result. It passes with `pnpm exec vitest run --config vitest.config.ts rsh/Compatibility/DSH/bridge/compat-dsh-runtime/tests/native.spec.ts rsh/Compatibility/DSH/bridge/compat-fs-local/tests/native.spec.ts rsh/Compatibility/DSH/bridge/compat-fs-policy/tests/native.spec.ts rsh/Compatibility/DSH/bridge/compat-fs-sandbox/tests/native.spec.ts rsh/Compatibility/DSH/bridge/compat-tool-fs/tests/native.spec.ts --reporter dot` (5 files, 18 tests); the execution log is `output/p4-compat-loader-lifecycle/native-bridge-focused-after-recovery-attempt-3.log`.

## Related

- [Filesystem compatibility version support](2026-10-05-compatibility-filesystem-version-support.md)
- [Native compatibility bridge](2026-09-22-native-compatibility-bridge.md)
- [Compatibility runtime README](../../../../rsh/Compatibility/DSH/bridge/compat-dsh-runtime/README.md)
