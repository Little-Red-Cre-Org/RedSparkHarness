# Agent Note: Native compaction

Status: implemented

English | [中文](2026-10-08-native-compaction.zh.md)

## Problem

Context compaction, the tool-result pruner, and `/compact` existed only as Cordis plugins, so native profiles could grow history until the provider rejected the request. Native profiles need the same thresholds, model-generated summaries, durable `compaction/*` events, and human command while compatibility profiles keep their current behavior.

## Decision

`dsh-compaction` adds the Cordis-free `./native` Definition. It augments `NativeServices.compaction` with `compactIfNeeded(owner, trigger, signal)` and `compactNow(owner, signal, sourceCommandId?)`, where the owner is the Program's per-session writer view (`session`, `writerAvailable`, `append`, `flush()`). `CompactionTrigger` and `ManualCompactionError` move to a runtime-neutral module that both entries export, so the failure taxonomy and the event vocabulary of the [compaction capability seam](../feature/2026-06-18-compaction-capability-seam.md) stay single-sourced.

`dsh-compaction-basic`, `dsh-compaction-tool-result-pruner`, and `dsh-command-compact` become mixed packages. Their region transaction, trigger policy, pruning core, and command parser and renderer are shared modules that take an explicit `append` target instead of a Cordis `Agent`; the Cordis entries delegate to them unchanged. The native compaction provider subscribes to attach and detach events, then installs one `beforeStep` admission hook per current owner at order `100` (configurable as `admissionOrder`); owner identity deduplicates an owner found both ways. The hook runs the shared pressure policy inside the open turn and then continues admission, matching the compatibility `agent/pre-step` placement before request derivation and before Goal continuation (`700`). Provider disposal drains accepted lifecycle callbacks before snapshotting and draining remaining hooks. Capacity comes from the routed model descriptor, and summaries stream through native `model.stream()` to the configured summarizer target or the latest routed target. `compactNow()` writes a `turn: null` bracket and flushes the owner; it rejects with `busy` while the Program writer is unavailable.

Every shipped Native profile installs the token meter, the pruner, and compaction. SDK, ACP, Web, and TUI expose `/compact` through their existing command surfaces: the SDK routes a registered slash-command line through `session/prompt`; ACP advertises commands with `available_commands_update` and dispatches through `session/prompt`; Web uses its `session/command` RPC. These adapters call the shared `commands` and `compactNow` owners.

## Alternatives considered

**Port the Cordis listener model directly:** Rejected because native profiles have no `agent/pre-step` event; the Program's admission waterfall is the native point that runs inside the open turn before request derivation.

**Duplicate the transaction in the native entry:** Rejected because the bracket, retention, and shrink validation define durable log semantics; two copies would drift and produce different logs for the same history.

**Give compaction its own native retry loop:** Rejected because `llm-retry` already owns classified model recovery. The compaction provider participates through the model-execution recovery callback; after a durable surface replacement, the executor rebuilds `GenerateOptions` from the current Session surface before the shared retry proceeds.

## Consequences

Native and compatibility profiles persist identical `compaction/*` brackets and checkpoint messages, and the CLI depends on the compaction packages as required providers. On a classified context overflow, the shared native recovery policy compacts once and rebuilds the next request from the newly derived Session messages; compaction does not own a second retry loop. Before any request has been routed there is no summarizer target, so nothing is compacted. Native `compactRegion()` and the runtime invariant companion remain compatibility-only. The Web Host and Client expose the shared command over `session/command`; presentation remains the renderer's responsibility. This note extends, and does not supersede, the [after-call pressure and overflow recovery](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md) and [queued manual compaction](../feature/2026-07-30-queued-manual-compaction.md) decisions.
