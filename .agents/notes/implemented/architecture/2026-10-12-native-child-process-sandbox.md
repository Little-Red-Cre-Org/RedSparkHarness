# Agent Note: Confine native SDK child paths under the process sandbox

Status: implemented

English | [中文](2026-10-12-native-child-process-sandbox.zh.md)

## Problem

The native SDK child launcher creates its provider overlay and private home under host temporary storage. The workspace-write bwrap profile replaces `/tmp`, which hid those files and a selected cwd located under `/tmp` from the confined child.

## Decision

`ProcessSandbox.confineChildProcess` receives the child's canonical cwd and launcher-owned private home alongside the resolved file policy. `sandbox-local` keeps the selected cwd visible and read-only unless an existing policy grant contains it, and grants the exact private home the write access needed by the child runtime. The bwrap workspace-write profile keeps its ephemeral `/tmp`, restores a selected `/tmp` cwd with a read-only bind, and applies the authorized workspace and private-home binds afterward.

The ordinary `confine` path and `SandboxPolicy` are unchanged. The SDK launcher remains responsible for creating and removing its private home; sandbox cleanup does not replace that ownership. The bwrap workspace-write profile keeps host `/tmp` siblings hidden. The Linux required CI lane runs both real-bwrap child cases after the pinned runner's functional probe.

## Alternatives considered

**Bind the host temporary root into the child.** This would expose sibling temporary paths and weaken the isolation provided by the ephemeral `/tmp`.

**Place the child home under the parent workspace.** This would make private provider state writable through the parent's broader workspace grant.

## Consequences

Native SDK child startup can read its exact provider overlay after bwrap installs the workspace-write profile. The parent workspace grant remains conditional on the existing Native Headless file-tool authority, and other temporary siblings remain hidden. The Windows ACL runner retains its reported partial enforcement status.
