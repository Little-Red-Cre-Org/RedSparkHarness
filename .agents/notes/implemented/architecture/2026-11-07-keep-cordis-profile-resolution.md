# Agent Note: Cordis profiles still resolve

Status: implemented

English | [中文](2026-11-07-keep-cordis-profile-resolution.zh.md)

## Problem

`resolveRshProfileDirectoryExecution` refused a `bundles` list and an explicit `runtime: 'legacy'`. That made a stale Cordis profile fail closed, which is what a release that no longer ships Cordis wants. This release still ships it. `legacy-sdk` is a closed snapshot profile and the Python SDK smoke launches `dsh --profile legacy-sdk`; both carry the bundle list. The refusal turned those lanes red without removing the runtime they exercise.

## Decision

A manifest with a `bundles` array and no runtime, or with `runtime: 'legacy'` and no native config fields, resolves `{ runtime: 'legacy', reload: 'startup' }`. The parser warns once per profile directory and names the native marker. It does not rewrite the manifest. A native marker that also declares `bundles` or `patchReload` still fails. A manifest that declares neither a native marker nor a bundle list still fails. A missing manifest stays legacy and does not warn, because that answer is "not initialized", not "Cordis".

## Alternatives considered

**Keep the hard refusal and move `legacy-sdk` onto a Native profile.** Rejected for this change. The snapshot manifest and the Python smoke exist to run the Cordis profile under its own name. Pointing them at Native would make the red CI green by stopping the test from testing Cordis, and the rewrite is larger than the resolver change.

**Silence the warning.** Rejected. A Cordis selection should stay visible while the copies remain, or the next deletion attempt will rediscover the same callers by breaking CI.

## Consequences

Cordis profiles boot again, and each one prints a warning the first time this process reads it. Deleting the Cordis halves stays blocked on those callers. Native compositions are unchanged: they still cannot carry a bundle list.
