# Agent Note: Native ACP covers cancellation and a refused permission

Status: implemented

English | [中文](2026-11-18-native-acp-covers-cancel-and-refusal.zh.md)

## Problem

The eight scenarios in `snapshots/acp/` build a Cordis ACP composition, so retiring that runtime needs Native ACP protocol coverage first. Only handshake, text turn, permissions, MCP and external-child had any, and three of those live in `snapshots/native-acp/` while nothing ran them in pull-request CI.

The legacy suite itself was not a usable oracle: on a clean build it pushes `config_option_update` before the `session/new` response, so `stdout.expected.jsonl` no longer matches for most cases.

## Decision

Cover the protocol behaviors the Native server already implements, then remove the legacy scenarios whose behavior is now exercised natively.

`snapshots/native-acp/cancel.snapshot.ts` drives the shipped `acp` profile over JSON-RPC against a local fixture model:

- a streaming turn that never finishes is cancelled, and `session/prompt` settles with `stopReason: 'cancelled'`;
- a `write_file` turn raises `session/request_permission`, the client answers `reject-once`, the tool call reports `failed`, and no file lands on disk.

That covers `cancel` and `escalation-rejected`; `handshake` was already covered by `snapshots/native-acp/legacy-handshake.snapshot.ts`, and the allow path by the permission turn in `snapshots/native-acp/text-turn.snapshot.ts`. Those three legacy directories leave the corpus.

`snapshots/native-acp/*.snapshot.ts` now has a pull-request CI step. Before this, the files ran only where the whole corpus ran.

## Consequences

Four scenarios stay in `snapshots/acp/`: `reject-extra-dirs`, `cancel-tool-calls`, `fs-escalation-approved` and `image-compaction`. `escalation-approved` stays with them because it owns the `acp-default` request-header pin and its sidecars.

Two of the four describe behavior the Native ACP does not have, rather than a test that has not been written:

- `reject-extra-dirs` asserts that `session/new` rejects `additionalDirectories`. That validation lives in `rsh/Programs/ACP/packages/acp/src/index.ts`; `native-acp` never reads the field, so it silently accepts what the legacy server refused.
- `fs-escalation-approved` writes with `sandbox_permissions: danger-full-access` and a justification. The Native `write_file` schema has no `sandbox_permissions` parameter.

Neither can be migrated by writing a test. Each needs a Native implementation or an explicit retirement, and the note records the gap rather than dropping the evidence.

[Native ACP refuses extra workspace roots and covers tool cancellation](2026-11-18-native-acp-refuses-extra-workspace-roots.md) implements the `additionalDirectories` refusal and the in-flight cancellation test, so those two scenarios leave the corpus.

## Alternatives considered

**Migrate the whole ACP suite to the Native profile at once.** Rejected: the suite applies Cordis YAML patches, so it needs a Native composition built first, and four scenarios would still be left without a behavior to assert.

**Delete every legacy ACP scenario now.** Rejected: `reject-extra-dirs` and `fs-escalation-approved` describe behavior the Native server does not implement. Deleting them would turn a known gap into an untracked one.

**Keep the three redundant scenarios as extra coverage.** Rejected: they replay the legacy runtime that is being retired, and their expected output already disagrees with what that runtime produces.

## Verification

`pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/native-acp/{legacy-handshake,text-turn,cancel}.snapshot.ts` passes, and the corpus gate accepts the new adapter. `pnpm run lint` and `pnpm run typecheck` pass.

The legacy ACP suite still reports its four remaining scenarios failing on the `config_option_update` ordering, as it did before this change; the corpus no longer registers the three directories removed here.
