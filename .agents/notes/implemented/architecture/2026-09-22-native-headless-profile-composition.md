# Agent Note: Native headless profile composition

Status: implemented

English | [中文](2026-09-22-native-headless-profile-composition.zh.md)

## Problem

The native host library can install plugins but cannot launch a user task, execute a real tool, or persist a Session through the supported `dsh --profile` entry. A synthetic host-only demonstration cannot establish that profile discovery, filesystem effects, shutdown, and released Session storage work together.

## Decision

An explicit `dsh.profile.runtime: "native"` marker selects a versioned JSON profile. Its installation rows name packages, scopes, ids, and complete config values; ordered JSON patches replace only existing rows. The CLI validates every selected package's native metadata before importing plugin entries, rejects nonempty Cordis patch layers, and launches exactly one application through `NativeHost.run()`.

The native headless application owns a minimal one-turn agent over native filesystem and observation-policy Providers, the existing Session event format, the JSONL backend, and a native streaming model service. It confines the two file tools to the configured workspace, records model-visible inputs and tool outcomes before the next model request, and flushes and closes storage before exit. Resume reads durable history asynchronously, refuses changed workspace and system-prompt settings, and records a full resume request header. Construction reports its new seed marker to the caller, and new appends are collected from their return values instead of synchronously scanning Session history. Failed or aborted turns use the Session interruption repair to settle unfinished tool calls before closing their step and turn.

## Alternatives considered

**Launch a private test entry.** That would bypass the public CLI, profile marker, package metadata checks, and shutdown path that the slice needs to verify.

**Reuse Cordis boot for native rows.** That would create a Cordis Context and make the native host depend on the compatibility interpreter. The native profile has its own strict JSON parser and refuses unconverted Cordis patches.

**Clone the full agent loop into the native application.** That would duplicate its tool registry, approval policies, and broader product semantics before their service definitions have migrated. The application exposes only the file operations needed to prove real execution and persistence.

## Consequences

The public CLI can run a native profile with real file effects and released Session data while keeping Cordis profile behavior intact. The minimal application is deliberately narrower than the Cordis headless composition; it has no approval, SDK, Web, or general tool-registry surface. Session and JSONL packages retain Cordis imports during this phase, although the native execution path constructs no Cordis Context. The [migration proposal](../../proposed/architecture/2026-09-22-rsh-native-runtime-and-optional-cordis.md) tracks subsequent compatibility and dependency work.

## Verification

The built `dsh` profile test uses real filesystem, observation-policy, JSONL, and application packages with only the external model substituted. It checks file contents, durable log restore, cancellation, and a loader probe that throws if any Cordis Context is constructed. Direct composition tests check empty writes, workspace denial, Session continuation, and model finish behavior.
