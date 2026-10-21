# Agent Note: Native browser exports install without Cordis

Status: implemented

English | [中文](2026-09-23-native-browser-export-dependency-closure.zh.md)

## Problem

The [published dependency policy](2026-08-26-published-dependency-faces.md) requires Cordis as a package-level peer for Client packages. A consumer importing only a new native browser subpath would therefore install Cordis even if the subpath never loads it. The ordinary static Client build also externalizes workspace imports while classifying them as development dependencies, so merely adding `./native` to an existing package can leave its published JavaScript or declarations referring to packages absent from an isolated install.

## Decision

A mixed Client package may mark its Cordis peer optional only when it publishes a separate `./native` export. `verify-package-dependencies` checks the exact `{ "optional": true }` metadata and continues to require matching Cordis peer and development ranges; a package without the native export cannot opt out. The existing root and `./client` entries continue to use Cordis and fail if a caller imports them without it.

`verify-optional-dependency-imports` follows the native source entry and its static value imports, rejecting Cordis in that reachable source while allowing the separate legacy entry to load it. Its fixture proves that a transitive native import is rejected. The packed-consumer check below verifies the emitted installation path independently.

The `dsh-client-modules/native` bundle contains the browser module table and graph parser; the package declaration parser, whose public type refers to `dsh-package-manifest`, remains on the legacy face. The `dsh-client-web/native` bundle contains the native installation runtime and exposes structural browser inputs and host-lifetime types. Neither native entry has a workspace import in its packed JavaScript or public declaration closure. A built-artifact test packs both packages, installs them into an empty project offline, rejects Cordis imports, checks Cordis is absent, and compiles a NodeNext consumer without skipping library checks.

## Alternatives considered

**Make Cordis optional without checking installed artifacts.** Workspace tests always have Cordis and every development package available, so they cannot prove the optional peer's absence is safe. The isolated packed consumer is the required evidence for these entries.

**Publish the native Web entry with a runtime import classified only as a development dependency.** That makes the installed `./native` export fail when the workspace runtime package is absent. The native Web bundle contains the runtime instead.

**Split both packages immediately.** Separate native and compatibility packages may be appropriate when the full Client roster migrates. Keeping distinct export paths now preserves the existing graph transport while Host selection and the native renderer are still under development.

## Consequences

The two native browser entrypoints can be installed, imported, and typechecked without Cordis. This does not make the production Web application native: its current entry still activates the Cordis Loader, and Host-provided native selection plus a native renderer are outstanding. Any later native export that requests another package at runtime needs its own declared install closure and isolated-consumer evidence; the presence of `./native` alone proves neither.
