# Agent Note: The E2B packages lose their Cordis entries

Status: implemented

English | [中文](2026-11-19-e2b-packages-drop-cordis-entries.zh.md)

## Problem

`@redspark/rsh-e2b`, `@redspark/rsh-fs-e2b`, and `@redspark/rsh-subprocess-e2b` each published two installers from one package: a Cordis Service in `src/index.ts` and a Native installer in `src/native.ts`, sharing the sandbox owner, filesystem backend, and subprocess backend. The Cordis half subclassed `Service`, `FileSystem`, and `SubprocessRuntime`, declared `@redspark/cordis` as an optional peer, and kept the family in `mixedNativeEntryDirectories`. No shipped or documented `cordis.yml` mounts the family, so the Cordis entries preserved a boot surface with no consumer and kept Cordis inside packages the Native profiles already use.

The entries also encoded Cordis-specific teardown: the owner and subprocess backends registered disposers through `ctx.effect`, which logged cleanup failures instead of reporting them to the caller.

## Decision

The three packages are Cordis-free Native packages.

`src/index.ts` re-exports the shared implementation and imports nothing from Cordis: the owner and control-shell helpers for `e2b`, `E2BFileSystemBackend` for `fs-e2b`, and `E2BSubprocessBackend` plus `resolveE2BSubprocessPollMs` for `subprocess-e2b`. The `./native` installers are unchanged: `e2b` provides `e2b`, `fs-e2b` requires `e2b` and provides `fs`, and `subprocess-e2b` requires `e2b` and provides `subprocess`.

Each manifest drops the `@redspark/cordis` peer and development dependency, its optional-peer marker, and `@redspark/schemastery`; `e2b` also drops the unused Cordis test fixtures. The `dsh.runtime` capability role metadata stays because it describes the provider seam rather than the runtime. The packages move from `mixedNativeEntryDirectories` to `nativePackageDirectories` with an explicit `host` compiler face.

Configuration is owned by the Native validators: `resolveNativeE2BConfig` accepts optional `apiKey`, `cwd`, and `timeoutMs`, and `resolveNativeE2BSubprocessConfig` accepts optional `pollMs`. The generated configuration catalog no longer lists these packages, and the generated `ctx.e2b` Cordis service section is removed from the subprocess subsystem page.

Tests construct the shared objects directly: `E2BSandboxOwner`, `E2BFileSystemBackend`, and `E2BSubprocessBackend`. The keyed Loader composition fixture and its `bin.ts`, `cordis.yml`, and LSP stub are deleted with the Cordis entry.

## Consequences

Teardown failures reach the caller. `E2BSandboxOwner.dispose()` rethrows a non-`SandboxNotFoundError` kill failure, and `E2BSubprocessBackend.dispose()` throws a single cleanup failure or an `AggregateError` for several. Under Native, the host's resource owner collects these into its composition cleanup failure, so an E2B teardown failure marks cleanup failed instead of being logged and dropped.

The family no longer has a keyed end-to-end test through a Loader composition. Remote credential scrubbing, process publication, and terminal teardown remain covered against fake sandboxes, and the three `native.spec.ts` files cover configuration validation and installer ownership. No test now exercises a real E2B sandbox through a shipped profile.

The Cordis service keys `ctx.e2b` and the Cordis adapters named `E2BRuntime`, `E2BFileSystem`, and `E2BSubprocessRuntime` no longer exist. Consumers of the shared code import the package root or `@redspark/rsh-e2b/owner`; they cannot reach an E2B provider through a Cordis composition.

## Alternatives considered

**Keep the Cordis entries as thin wrappers.** They only forwarded to the shared owner and backends, but they would keep the Cordis peer, the mixed package classification, and a second test harness alive until the Cordis runtime itself is deleted. The wrappers would then have to be removed anyway, with no consumer ever mounting them.

**Port the Service shells instead of deleting them.** A Native `e2b` service shell would duplicate the installer that already provides the owner, and a Native `fs` or `subprocess` shell would duplicate the backends the installers already provide. The shells add a class layer with no independent behavior.

**Keep the composition fixture on Native boot.** The fixture's subject was the Cordis Loader composition and its credential scrubbing through Cordis-managed shells. Native profile boot already has its own composition tests, and the deleted fixture did not cover a Native profile loading this family.
