# Agent Note: Windows pkg profile proxies keep one snapshot module identity

Status: implemented

English | [中文](2026-10-15-windows-pkg-profile-proxy-module-identity.zh.md)

## Problem

pkg's Windows loader can open one snapshot file through C: and V: drive aliases. ESM keys modules by URL. The SEA bootstrap imports the entrypoint as `file:///C:/snapshot/...`, and the VFS resolve hook keeps that C: drive for imports from C: parents, so the executable's own `@deepseek-ai/cordis` instance lives under C:. A profile proxy that re-exports a V: URL loads a second instance, and an external plugin that imports Cordis through the proxy fails `instanceof Context`.

## Decision

`dsh-app-boot` derives the Windows snapshot root from `process.pkg.entrypoint` and `defaultEntrypoint`. It writes targets inside that root under the entrypoint's own drive root and keeps ordinary filesystem targets on `pathToFileURL` URLs.

## Alternatives considered

**Process-wide symbol registries or wider export allowlists.** These conceal a duplicated module instance or expose unsupported package paths instead of aligning the ESM module URLs.

**Rewrite every Windows path.** External files do not belong to pkg's snapshot and retain their ordinary disk URLs.

## Consequences

Profile proxies and the executable's own imports resolve snapshot files under the same C: URL, while plain Node and external package targets keep their existing URL behavior. A different packaged loader mapping must update the path derivation with its entrypoint URL.

## Testing

The Windows case in [`profile.spec.ts`](../../../../rsh/Compatibility/DSH/boot/app-boot/tests/profile.spec.ts) exercises `healProfilesModuleFallback` and verifies both the entrypoint-root snapshot target and an external disk target. The installed-wheel `sdk-profile-plugin` smoke on Windows loads an external plugin whose `@deepseek-ai/cordis` peer must be the executable's instance.
