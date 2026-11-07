# Agent Note: The LSP seam is mixed native

Status: implemented

English | [中文](2026-11-07-lsp-seam-is-mixed-native.zh.md)

## Problem

`@redspark/rsh-lsp`, `@redspark/rsh-lsp-stdio`, and `@redspark/rsh-tool-lsp` each shipped a Native entry next to their Cordis plugin, but `rsh/Scripts/native-package-policy.ts` classified none of them. `check:ci:package-publication` reported both consequences: the compatibility rule demanded a required Cordis peer these packages declare optional, and the native-source walk could not attribute their entry sources. The walk also reached `@redspark/cordis` through the entries themselves: the stdio core sat in `index.ts` beside `apply`, the tool's caps and load-time checks sat in the Cordis plugin, and `registry.ts` took `HarnessError` from `@redspark/rsh-llm`.

## Decision

The three packages are registered in `mixedNativeEntryDirectories`, each with the shared implementation stated as its reason: extension routing and conflict checks for `lsp`, executable resolution, isolation and teardown for `lsp-stdio`, and argument checks, caps and result rendering for `tool-lsp`.

That classification is only honest if the Native entry's whole import closure stays off Cordis, so each shared implementation moved behind a Cordis-free module. `lsp-stdio` keeps `apply` in `src/index.ts` and moved the config schema, executable resolution, provider construction, and teardown to `src/providers.ts`. `tool-lsp` moved its caps, timeout budget, prompt text, and load-time checks to `src/config.ts`; `src/index.ts` keeps tool registration and the system-prompt section. `render.ts` imports `GenericCallView` from `@redspark/rsh-native-tools/presentation` instead of `@redspark/rsh-tools`, because the latter carries a Cordis peer. `registry.ts` takes `HarnessError` from `@redspark/rsh-errors`, which `@redspark/rsh-llm` only re-exported.

Both entries call the same moved functions, so the seam keeps one implementation per operation rather than one per runtime.

## Alternatives considered

**Write Native re-implementations of the three packages.** Rejected. The Native entries would then need their own extension routing, process pooling, and result caps, and the two runtimes would drift on the behavior a query is judged by.

**Mark the packages compatibility-only and leave their Native entries unclassified.** Rejected. The entries ship in every Native profile that enables code navigation, so the walk would keep failing on them, and the packages would lose the publication rule that says which peers may be optional.

**Suppress the two gate messages for this seam.** Rejected. Both messages report a real disagreement between the manifest and the source: the peer rule reads `peerDependenciesMeta`, and the walk reads actual imports. Silencing them would have left the Cordis import in the Native closure.

## Consequences

The three Native entries reach their implementation without the Cordis peer, and `verify-native-dependencies` walks that closure to prove it. The audit surface is the category table: a new import into `lsp-stdio/src/providers.ts` or `tool-lsp/src/config.ts` can put Cordis back into the Native chain, and that gate is what catches it.

`@redspark/rsh-lsp` and `@redspark/rsh-lsp-stdio` no longer declare `@redspark/rsh-llm`, which nothing in either package imports. `@redspark/rsh-tool-lsp` keeps it because its Native test imports `ToolCallId` from `@redspark/rsh-llm/native`.

The Cordis plugins stay: this change classifies them, it does not delete them. Nothing here moves the seam's behavior, coordinate handling, or error codes.
