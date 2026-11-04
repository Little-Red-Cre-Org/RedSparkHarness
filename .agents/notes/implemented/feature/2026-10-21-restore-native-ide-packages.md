# Agent Note: Restore the Native IDE provider packages

Status: implemented

English | [中文](2026-10-21-restore-native-ide-packages.zh.md)

## Problem

A detached worktree held an unfinished Native IDE slice — a Code OSS provider and the profile application that consumes it. The worktree's repository was lost, so the only surviving copy was a file snapshot pushed as `restore/startup-20261021`. That snapshot predates the product rename, so its manifests, imports and identifiers all name the upstream product, and `main` carries neither package. The code existed but nothing in the shipped tree could type-check it.

## Decision

Restore the two packages that make the provider usable, and nothing else:

- `rsh/Modules/Official/ide/ide-code-oss` — the Native Provider. It resolves an absolute Code OSS runtime, workspace and data directory from profile configuration, owns a `127.0.0.1` server process through the `subprocess` service, and publishes the resulting URL and exit promise as the `ide` service.
- `rsh/Programs/Web/host/native-ide` — the application. It requires `ide`, provides `application`, and blocks on cancellation or server exit.

Both are registered in `native-package-policy.ts` as source owners and as Host-only compiler faces, because `verify-native-dependencies` derives its admitted graph from that file; an unregistered native package fails the gate even when it compiles.

The Desktop integration — the Electron IDE window, its VSIX adapter, the handoff protocol and the Web workbench UI — stays out of this change. Those layers depend on Desktop wiring that `main` no longer has, and restoring them is a separate decision with its own review surface.

## Alternatives considered

- **Merge `restore/startup-20261021` wholesale:** rejected because the branch is a whole-worktree snapshot whose root history is unrelated to `main`, and 141 of its 197 absent paths are moves rather than losses. Merging it would rewrite unrelated packages.
- **Copy the snapshot files unchanged:** rejected because every manifest, import and identifier in them names the upstream product. `pnpm install` and `tsc -b` fail on the first renamed workspace dependency.
- **Restore the Desktop window in the same change:** rejected because that layer needs Electron wiring, a bundled VSIX and a handoff protocol, and bundling it here would hide where the provider boundary actually is.

## Consequences

The Native graph gains one Provider and one application, and `main` can now build, type-check and verify them. A profile that selects `native-ide` still needs an installed Code OSS REH Web distribution at an absolute path; nothing in this change downloads, bundles or qualifies one. The Desktop window, the extension adapter and the in-product workbench remain unimplemented, so this restores the capability seam and not the editor a user opens.
