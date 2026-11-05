# Agent Note: Native entry face selection and derived package files

Status: implemented

English | [中文](2026-11-04-native-entry-face-and-package-files.zh.md)

## Problem

Two independent gaps made the `./native` subpath an exception rather than a first-class entry.

The [workspace constraint gate](../../../../rsh/Scripts/check-workspace-constraints.ts) derived each published package's `files` array from eight entry subpaths and not from `./native`, so every package that shipped a native bundle needed a hand-written `packageFileExtras` row. 153 rows carried `lib/native.js`; 22 of them carried nothing else.

The [Typert analyzer](../../../../rsh/Core/typert/generator/src/analyzer.ts) filtered `./client`, `./client/*`, and `./remote` out of the Host face and collected every other export. `dsh.native.targets` did not appear anywhere in the file. A package with a real Host program — `rsh-client-file-upload` owns `src/http-route.ts` and a Host service — and a Client-only native entry therefore had its `./native` resolved by the Host pass, which failed on a file the Host project never lists.

## Decision

`expectedRshPackageFiles` derives `lib/native.js` when the manifest's `./native` default target is exactly `./lib/native.js`, keyed on the artifact path like `./client`, `./worker`, `./runtime`, and `./startup`. A `./native` that points into the emitted `lib/types` tree is already covered by `usesEmittedTreeDefaults`, so the new row does not double-count it. The redundant `packageFileExtras` entries are deleted: 131 `lib/native.js` tokens stripped and 22 whole rows removed.

`hostExportSubpaths` excludes `./native` only when `dsh.native.targets` is declared and omits `host`. A package with no `dsh.native` is not a composition row: its `./native` stays an ordinary source export Host code may import, so the subpath stays in the Host pass.

## Alternatives considered

**Derive from the subpath name rather than the artifact path.** Every package exports `./native`, but 17 point it at `./lib/index.js`, three at the tsc-emitted tree, and one at `./lib/native-boot.js`. Publishing `lib/native.js` for those would add a file the build never emits, so the rule keys on the resolved target exactly as the existing `./client` row does.

**Keep `./native` in the Host pass and delete `tsconfig.host.json` from file-upload.** `src/http-route.ts` is a real Host compilation unit reached from `index.ts`; removing the project drops a genuine Host artifact to work around a subpath rule.

**Exclude `./native` whenever `targets` does not name `host`, treating an undeclared `dsh.native` as Client-only.** This reads as the stricter, more defensive rule and it emits byte-identical artifacts for the current workspace. It also silently drops the `./native` of every library that declares no native row: 21 packages such as `rsh-session`, `rsh-llm`, `rsh-subprocess`, and `rsh-http-routes` are not composition rows, but their `./native` is a real source export that Host code may legally import. Nothing imports it today, which is exactly why relying on today's importers would hide the break until someone writes that import.

## Consequences

A native bundle is published on the same footing as every other derived entry, and a new native package needs no `packageFileExtras` row. The gate now also catches a `files` array that omits `lib/native.js`.

The Host Typert pass no longer analyzes a native entry a manifest explicitly restricts to `client`. An undeclared native entry stays analyzable, so a library keeps a Host-importable `./native` without adopting the composition-row manifest.

## Verification

`check-workspace-constraints.spec.ts` pins the artifact-path rule, the emitted-tree exclusion, the absent-subpath case, and a stylesheet-bearing package. `native-targets.spec.ts` pins the three `dsh.native.targets` forms against a mixed package whose native entry declares a service the Host pass would otherwise emit.

The file-upload reproduction — its manifest plus a minimal `src/native.ts` in `tsconfig.client.json` — failed with `typert(host): ... export ./native resolves to missing source src/native.ts` before the change and generates cleanly after it.
