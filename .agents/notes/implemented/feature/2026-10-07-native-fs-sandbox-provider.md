# Agent Note: Native filesystem sandbox provider—shared fence, Native lifecycle

Status: implemented

English | [中文](2026-10-07-native-fs-sandbox-provider.zh.md)

## Problem

The Native web and terminal profiles selected `@deepseek-ai/dsh-fs-sandbox`, but that package exposed only its Cordis runtime manifest. Native profile loading therefore rejected the selected filesystem entry before activation, while choosing `fs-local` would leave writes without the configured sandbox fence.

## Decision

Keep the Cordis `runtime` entry and add a Host-only `native` entry to the same package. The Native entry requires the Native `sandboxPolicy` service and provides the one `fs` service. It subclasses the existing `LocalFileSystemBackend`; reads, target identity, atomic writes, observed versions, streams, and mutation locking keep one implementation.

Cordis and Native writes and edits call one shared target check. It uses `writableRoots` from `dsh-sandbox` and the existing canonical path and filesystem-identity containment implementation. `read-only` rejects mutations, `workspace-write` re-resolves before checking containment, and `danger-full-access` delegates without a path fence. The native entry does not own session policy or approval decisions; the Native policy and tool layers supply those per call.

The Native installation connects its abort signal to backend close and owns the awaited close operation. The provider tracks each admitted write and edit from policy resolution through backend I/O; shutdown rejects later mutations, cancels backend work, and waits for both the policy checks and local operations to settle before its Native Host owner releases it.

The package marks Cordis, Plugin Host, and the legacy `dsh-sandbox-policy` peer optional for Native-only installation. Those fields permit the installer to omit peers; they do not select an entry or make the Cordis face load without its host and policy providers. Native profiles must select `dsh-native-sandbox-policy` explicitly. This provider does not claim kernel-grade filesystem isolation, and other profile packages may still require Cordis.

## Alternatives considered

**Use `fs-local` in Native profiles and leave confinement to file tools.** Rejected because writes through the filesystem service would bypass the sandbox whenever a caller did not enter through `dsh-tool-fs`.

## Consequences

The Native entry and the Cordis adapter share the same write fence, so both keep the same mode and target semantics. Native compositions must select a policy provider explicitly, and the in-process path check remains distinct from kernel isolation.

## Related decisions

- [Cross-family file sandbox](2026-07-14-cross-family-fs-sandbox.md) — shared modes, per-call policy, and the Cordis enforcement face.
- [Native profile template](../../../../rsh/Programs/CLI/src/native-profile-template.ts) — selected Host filesystem provider in the web and terminal compositions.
