# Agent Note: Publish the Workflow type runtime module

Status: implemented

English | [中文](2026-10-07-workflow-types-runtime-publication.zh.md)

## Problem

The Workflow root bundle imports the generated `lib/types.js` runtime module. Its package allowlist included nested `lib/types/**/*.js` outputs but omitted this root-level module, so an installed root import could not resolve its own runtime dependency.

## Decision

The Workflow package publishes `lib/types.js` explicitly, and the workspace package-payload policy requires the same exact file. The public `./types` export keeps its existing target and behavior.

## Alternatives considered

**Publish every JavaScript file under `lib/`:** Rejected because that would broaden the package beyond its declared entries and add unrelated generated files.

**Change the `./types` export target:** Rejected because the missing module is imported by the root bundle; changing a separate public subpath would not repair that import and would alter its existing path.

## Consequences

The packed package includes the runtime module needed by `lib/index.js` while keeping its existing `./types` consumer path. The exact payload expectation prevents the package allowlist from dropping this root-level artifact again.

## Verification

The Host TypeScript build and tsdown build emit `lib/types.js`; the built root entry imports it. Package-payload tests require the file, and the packed consumer check imports the root, native, and existing `./types` entries.
