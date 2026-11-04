# Agent Note: Native Web Client installation rows and their published native entries

Status: implemented

English | [中文](2026-11-03-native-web-client-installation-rows.zh.md)

## Problem

The `native-web` profile selects browser Client packages through installation rows in `NATIVE_WEB_CLIENT_INSTALLATIONS`. A row reaches package code through `createRequire(manifestPath).resolve('<plugin>/native')` in [native-client.ts](../../../../rsh/Programs/Web/host/native-web-assets/src/native-client.ts), so a row is loadable only when three independent facts hold: the package's build emits the file its `exports["./native"].default` names, that package's `files` list publishes it, and Desktop packaging pulls the packed tarball rather than the working tree.

A row can satisfy every pre-build gate while one of those facts is false. `verify-native-client-entries` reads sources and manifests; the Client entry then passes it because `src/native.ts` exists and exports `plugin`. The build preset decides whether `lib/native.js` is emitted at all, and `files` decides whether npm keeps it. Desktop packaging assembles from `.tgz` files, so "it loads in my checkout" does not imply "the packaged application loads it". A package that fails either step passes every static gate and then fails minutes into packaging, inside `prepare-dsh`, as `MODULE_NOT_FOUND` naming the row rather than the build.

## Decision

Four Client packages carry `native-web` rows: `ui-brand-official`, `ui-input-trigger`, `ui-jobs`, and `ui-message-feedback`. Each one's `./native` subpath is a statically linked leaf built by `staticLinkedLeaf` from [tsdown.client.ts](../../../../rsh/Programs/Web/client/tsdown.client.ts) and named in its `package.json` `files`.

The three facts are separate owners. `tsdown.config.ts` decides what the build emits, the manifest's `exports` map decides what the subpath resolves to, and the manifest's `files` array decides what a tarball carries. `clientBundle` alone builds only the node half and the browser bundle, so a package that adds `./native` without `staticLinkedLeaf` advertises a file its own build never writes.

`check-workspace-constraints` derives an expected `files` array from the manifest, recognising `./client`, `./invariant`, `./worker`, `./store`, `./startup`, `./runtime`, `./loader`, and `./typert` subpaths. It does not derive an entry from `./native`, so a package publishing a native leaf records `lib/native.js` in the `packageFileExtras` table instead. Deleting the entry to satisfy the gate would drop the artifact from the tarball.

`verify-native-build-output` checks both shipped compositions of the Web profile: the Host rows from `shippedNativeProfileComposition(home, 'web', platform)` and the browser Client rows from `shippedNativeProfileClientComposition('web')`. For each row it asserts that `exports["./native"].default` exists on disk and that the package's `files` list covers it. It runs after the build it inspects, marked `needs: ['build']` in [run-gates.ts](../../../../rsh/Scripts/run-gates.ts).

`ui-jobs` and `ui-open-in-app` publish their emitted stylesheet because their native leaf imports it by relative path; a native leaf that imports a stylesheet needs `lib/**/*.css` in `files` for the same reason it needs `lib/native.js`. Their `packageFileExtras` rows carry both entries.

`ui-jobs` is the only package here classified in `mixedNativeEntryDirectories`. That classification carries the optional Cordis peer the mixed-package rule requires, and it holds only while the native entry's source closure never reaches the package's Cordis half. The other three keep a required Cordis peer: their native entry reaches files that import `@redspark/cordis` or a sibling package's `./client` subpath, so classifying them as mixed fails `verify-native-dependencies`.

`ui-open-in-app` carries no `native-web` row. Its native leaf reads three route constants from `@redspark/rsh-host-open-in-app/shared`, and that package declares no `dsh.native` entry and appears in no shipped composition, so the Native assembly ships no `/open-in-app/*` route to answer those reads. The route constants reach the Client through `rsh-web-app`, which the Native assembly excludes. Giving the paper's row a working launch path needs a Native host half for those three routes; the row returns when that half exists.

## Alternatives considered

**Rely on `verify-native-client-entries` for this class of defect:** rejected because it reads the source plane. `src/native.ts` exporting `plugin` says nothing about whether tsdown emits `lib/native.js` or whether npm publishes it, which is where both observed defects lived.

**Check the working tree only:** rejected because Desktop packaging reads packed tarballs. `npm pack --dry-run --json` per package is the only check that sees the payload the packager sees; `Test-Path` on `lib/native.js` reports success for a package whose `files` list strips the file.

**Derive `./native` inside `expectedRshPackageFiles()`:** rejected for this change because the derivation would then also apply to every Host package whose `./native` is emitted together with its package entry, changing their expected arrays. Recording those packages in `packageFileExtras` keeps the change to the packages that actually publish a separately built native leaf.

**Give `dir` its own output directory:** rejected because `--dir` and `--unsigned` are independent axes in [package-target.ts](../../../../rsh/Programs/Desktop/scripts/package-target.ts). `dir` now runs with `--unsigned`, so electron-builder writes to `unsigned-artifacts`; the shared directory follows from that, and [package-desktop-win.ps1](../../../../rsh/Scripts/package-desktop-win.ps1) verifies against it.

## Consequences

A Client package can carry a `native-web` row only when its build, its `exports` map, and its `files` list agree; `verify-native-build-output` now reports a violation of any of the three against the row id instead of letting packaging fail later. Its failure output names the composition kind, so a missing Client artifact is distinguishable from a missing Host artifact.

The gate reads built `lib/` output, so it is a post-build row. A run without its own build has no Client artifacts to inspect and omits the row, exactly as it already did for the Host rows.

Adding a Client row to the shipped composition now changes a checked set: the row must resolve to a package whose `./native` a build produces and whose `files` publishes, or the gate goes red before packaging starts.
