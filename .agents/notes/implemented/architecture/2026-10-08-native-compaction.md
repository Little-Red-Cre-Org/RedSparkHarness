# Agent Note: Native compaction

Status: implemented

English | [中文](2026-10-08-native-compaction.zh.md)

## Problem

Context compaction, the tool-result pruner, and `/compact` existed only as Cordis plugins, so native profiles could grow history until the provider rejected the request. Native profiles need the same thresholds, model-generated summaries, durable `compaction/*` events, and human command while compatibility profiles keep their current behavior.

## Decision

`dsh-compaction` adds the Cordis-free `./native` Definition. It augments `NativeServices.compaction` with `compactIfNeeded(owner, trigger, signal)` and `compactNow(owner, signal, sourceCommandId?)`, where the owner is the Program's per-session writer view (`session`, `writerAvailable`, `append`, `flush()`). `CompactionTrigger` and `ManualCompactionError` move to a runtime-neutral module that both entries export, so the failure taxonomy and the event vocabulary of the [compaction capability seam](../feature/2026-06-18-compaction-capability-seam.md) stay single-sourced.

`dsh-compaction-basic`, `dsh-compaction-tool-result-pruner`, and `dsh-command-compact` become mixed packages. Their region transaction, trigger policy, pruning core, and command parser and renderer are shared modules that take an explicit `append` target instead of a Cordis `Agent`; the Cordis entries delegate to them unchanged. The native compaction provider installs one `beforeStep` admission hook per attached session at order `100` (configurable as `admissionOrder`). The hook runs the shared pressure policy inside the open turn and then continues admission, matching the compatibility `agent/pre-step` placement before request derivation and before Goal continuation (`700`). Capacity comes from the routed model descriptor, and summaries stream through native `model.stream()` to the configured summarizer target or the latest routed target. `compactNow()` writes a `turn: null` bracket and flushes the owner; it rejects with `busy` while the Program writer is unavailable.

The shipped `native-headless`, `native-web`, and `native-tui` profiles install the token meter, the pruner, and compaction; `native-tui` also mounts `/compact`. `native-sdk` and `native-acp` stay minimal compositions.

## Alternatives considered

**Port the Cordis listener model directly:** Rejected because native profiles have no `agent/pre-step` event; the Program's admission waterfall is the native point that runs inside the open turn before request derivation.

**Duplicate the transaction in the native entry:** Rejected because the bracket, retention, and shrink validation define durable log semantics; two copies would drift and produce different logs for the same history.

**Add native context-overflow recovery now:** Deferred because the native executor exposes no request-error hook and retry policy belongs to the separate native LLM guard work. `compactIfNeeded(owner, 'context-overflow', signal)` remains available for that integration.

## Consequences

Native and compatibility profiles persist identical `compaction/*` brackets and checkpoint messages, and the CLI now depends on the compaction packages instead of treating them as optional. Native profiles do not retry provider overflow responses after compaction. Before any request has been routed there is no summarizer target, so nothing is compacted. Native `compactRegion()` and the runtime invariant companion remain compatibility-only, and native Web has no command surface for `/compact`. This note extends, and does not supersede, the [after-call pressure and overflow recovery](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md) and [queued manual compaction](../feature/2026-07-30-queued-manual-compaction.md) decisions.
