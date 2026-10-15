# Agent Note: Windows pkg profile proxies keep one snapshot module identity

Status: implemented

English | [中文](2026-10-15-windows-pkg-profile-proxy-module-identity.zh.md)

## Problem

pkg's Windows loader can open one snapshot file through C: and V: drive aliases. ESM keys modules by URL, so a profile proxy that re-exports a C: URL can load a second provider instance beside a bare import resolved through V:.

## Decision

`dsh-app-boot` derives the Windows snapshot root from `process.pkg.entrypoint` and `defaultEntrypoint`. It writes targets inside that root through pkg's V: alias and keeps ordinary filesystem targets on `pathToFileURL` URLs.

## Alternatives considered

**Process-wide symbol registries or wider export allowlists.** These conceal a duplicated module instance or expose unsupported package paths instead of aligning the ESM module URLs.

**Rewrite every Windows path.** External files do not belong to pkg's snapshot and retain their ordinary disk URLs.

## Consequences

Profile proxies and bare imports resolve snapshot files under the same V: URL, while plain Node and external package targets keep their existing URL behavior. A different packaged loader mapping must update the path derivation with its VFS alias.

## Testing

The Windows case in [`profile.spec.ts`](../../../../rsh/Compatibility/DSH/boot/app-boot/tests/profile.spec.ts) exercises `healProfilesModuleFallback` and verifies both the V: snapshot target and an external disk target. The bounded pkg SEA probe confirms that C: and V: reach the same mounted file but produce different ESM cache keys.
