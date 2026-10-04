# Agent Note: Native Web compiler faces and published entries

Status: implemented

English | [中文](2026-10-05-native-web-policy-faces.zh.md)

## Problem

Four existing Web packages publish native entries that are absent from the native owner and payload tables. The asset builder's native-client filename identifies its output, not its execution face: its implementation runs on the Host.

## Decision

The [native Web Host](../../../../rsh/Programs/Web/host/native-web-host/README.md) and [asset builder](../../../../rsh/Programs/Web/host/native-web-assets/README.md) are pure Host owners. [Explicit compiler targets](../../../../rsh/Scripts/native-package-policy.ts) keep their Node and bundler sources on the Host. [Connection](../../../../rsh/Programs/Web/client/connection/README.md) and [UI Renderer](../../../../rsh/Programs/Web/client/ui-renderer/README.md) retain their compatibility entries and are classified by their existing native Client installer descriptors. Connection's native-host and native-http-bridge exports and the asset builder's native-client export are checked on their actual Host face.

The [publication whitelist](../../../../rsh/Scripts/check-workspace-constraints.ts) admits only the existing native bundles and Connection transport chunks named by these four manifests. Every classified public entry still requires a real source export; source scans continue to reject Cordis and missing referents.

A manifest without exports produces the missing-source diagnostic instead of an indexing TypeError; it is never accepted as a valid entry.

## Alternatives considered

Scanning the asset builder as a Client would require a nonexistent Client compiler owner and misclassify Node dependencies. Adding Cordis peers to pure Host packages would change their installation requirements without a runtime need.

Copying a future policy roster would admit unrelated packages and make this correction depend on unpublished implementations. The correction contains only owners already present in this tree.

## Consequences

These classifications preserve runtime behavior and compatibility imports. They introduce no profile selection, default switch or dependency seat. Compiler-face and publication checks remain separate from product execution evidence.
