# Agent Note: Native Jobs and Workflow packed acceptance

Status: implemented

English | [中文](2026-10-12-native-jobs-workflow-packed-acceptance.zh.md)

## Problem

Native Jobs registry, controls, spawn Subagent Provider, and Workflow Consumer/provider were already present. Unit and lifecycle tests did not prove that the independently installed CLI could resolve those packages, run the application path, or leave the owned Session facts cold-readable after shutdown. Existing native-headless snapshots used the repository CLI and workspace-linked packages, so they were not independent packed-consumer evidence.

## Decision

Add two opt-in, real-application fixtures under the owning `native-headless` CLI profile test directory. Both launch the packed `dsh` executable through Node with `--profile native-headless`, a fresh `DSH_HOME`, a local SSE model fixture, no inherited `NODE_OPTIONS` or `NODE_PATH`, and ordinary installed package dependencies. On the current base (`989c172`, including PR #207), a fresh native-headless template records the invoking directory as its application `cwd`. The fixtures intentionally overlay an isolated temporary `cwd` and local model configuration through the supported `--patch` mechanism so each test owns its workspace. This test-isolation override is not a workaround for the former template omission. Each fixture waits for the CLI process result and then reads Session JSONL from disk rather than runtime registries.

The Workflow fixture exercises the model-facing Workflow Consumer, the selected `worker-thread` Provider, and its `spawn` Subagent child; it verifies ordered durable workflow start/child end/run end facts and the returned child text. The Jobs fixture starts two real background spawn Subagents through the native tool Consumer and shared Jobs registry, kills one, waits for its cancellation, cold-observes that the sibling remains running, then waits for the sibling's completion. It cold-reads the parent and both child Sessions and checks the persisted control results and terminal turns.

The packed Jobs fixture starts with `--dump-config` output from the packed CLI and adds only the already-shipped `@deepseek-ai/dsh-tool-subagent` Consumer to a temporary user profile. It waits for both child model streams, then uses bounded model-facing `job_output(wait:false)` probes until the live output and `running` status are present in both the owning Session and the next model request; only then does it cancel alpha. This uses state observations rather than a timing delay. The current shipped `native-headless` template already selects the native Jobs/control packages and `spawn` Provider but omits that model-facing Consumer. Therefore the default profile can expose Jobs controls and Workflow but cannot accept a direct model-requested Subagent spawn until its owner changes profile composition. This batch records the gap without changing the read-only CLI template.

## Evidence matrix

| Surface | Profile and execution path | Evidence | Limit |
| --- | --- | --- | --- |
| Workflow | Independently installed packed `dsh`, Linux x64, `native-headless`, local SSE model, worker-thread Provider, spawned Subagent | Process exit and cold parent/child JSONL with ordered workflow and result facts | One platform, one selected Provider; no external Codex/Responses or continuable support claim |
| Jobs | Same packed `dsh` and platform; temporary profile adds the existing Subagent Consumer | Two jobs in one Agent/Session path; one cancelled, sibling remains running and completes; cold parent and child JSONL | Shipped default profile omission remains; persisted lineage identifies child Sessions, while exact owner fencing is separately covered by Jobs unit tests |
| Owner and disposal | Existing `native-jobs`, `native-tool-jobs`, and `workflow-worker-thread` native tests | Exact Agent ownership, registry/control behavior, and a barrier-held native disposal path are covered separately from the packed application fixtures | The packed fixtures record the `dsh` process exit; they do not claim independent OS process/Worker introspection for each child |
| Package consumption | Lockfile-aligned local package tarballs, normal package install scripts, native addon present | Package manifest, tarball hashes, install result, and process/session evidence are recorded in the companion workspace evidence ledger | The standard release-family pack cycle fails before it can produce the family; the scoped package-level fallback does not certify published release ordering or the normal verifier end-to-end |

The native-headless CLI derives its Agent id from the root Session id; durable parent/child Session linkage plus job start metadata is consequently useful ownership lineage, not direct runtime introspection. Exact live-Agent fencing and teardown ordering remain established by the owning unit/lifecycle tests.

## Alternatives considered

- **Add the missing Subagent Consumer to the shipped native-headless template here:** rejected because profile-default composition is outside this batch's ownership. The controlled profile proves the existing Provider/registry path without silently changing defaults.
- **Reuse workspace-linked snapshots or manually assemble a Native Host:** rejected because neither proves the installed CLI and ordinary package resolution, and direct Host construction bypasses application wiring.
- **Add a fixture-only Jobs registry or Session writer:** rejected because it would duplicate authority instead of testing the existing Agent-owned registry and Program-owned Session.

## Commands and reproducibility

The companion evidence ledger records the full commands, working directory, Node/platform, exit codes, final base/head, installed tarball identity and SHA-256, process outcomes, and the cold Session files. Build artifacts were produced through the normal repository build with an equivalent supported Node ESM loader invocation because the default `tsx` CLI launcher is denied its IPC socket in this environment; the original launcher failure is retained. The release-family `pack.ts --family dsh` failure is also retained with its dependency-cycle diagnostic. A lockfile-aligned `koffi@3.1.1` consumer install is recorded separately from the upstream latest Koffi native build failure.

The acceptance is intentionally limited to the selected `native-headless` `spawn` path on Linux x64, using a temporary `cwd` only to isolate the test workspace. It does not imply support for other profiles or platforms, external API providers, external-driver background/continuable execution, long-running jobs across CLI invocations, or direct spawn from the shipped headless profile without its missing model-facing Consumer.

## Consequences

The application-level evidence now reaches the real packed CLI without introducing another Agent loop, registry, Session writer, or profile default. Future profile-composition work should add the direct Subagent Consumer where model-requested headless spawn is intended; it should preserve the existing Native Jobs registry and owner relationship.
