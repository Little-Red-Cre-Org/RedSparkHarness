# Agent Note: Native Session execution authority

Status: implemented

English | [中文](2026-10-05-native-session-execution-authority.zh.md)

## Problem

Native Programs need to share child execution, human maintenance and retained Session work without creating another writer or deriving live authority from historical parent ids.

## Decision

NativeAgent owns FIFO execution and exclusive idle maintenance for each exact registered identity. SessionExecution defines and provides active-owner routing, step admission and delegation. Headless supplies root operations and the continuation driver, using its existing model and tool dispatch. A retained Session has one writer, one durable inbox and one Program-owned activation; registry observations never activate a cold Session.

A preset lease selects the Agent scope before contribution preparation. Its selection is reconstructed from the existing header and canonical selection event. Removal cancels that lease before waiting for accepted work and releases the scope after it drains. Workspace native and Cordis Consumers share the existing v2 domain and global archive-id record; directory selection creates an immutable Program route without changing sandbox permission.

Recoverable deletion is an optional persistence capability. JSONL moves a complete Session directory, with every retained generation, into a receipt-addressed retained namespace. The Program checks the exact route and revision and refuses busy owners. Restoration checks the retained header and destination, and never overwrites an occupied Session. This capability does not erase generation bytes or modify committed repository fixtures.

Workspace error declarations use the canonical `@deepseek-ai/dsh-typert-protocol/types` owner. All existing Remote error-code declarations and fixture augmentations use that same owner, so native and compatibility Consumers retain one typed failure vocabulary. Lookup and Context registration maps keep their existing declarations. Session Remote errors remain in its compatibility entry; Web Consumers import that declaration explicitly rather than depending on Workspace to load it. Pure Session types retain no Typert dependency.

## Consequences

Model-visible inbox claims and selected input use existing Session events and are persisted before dispatch. Construction callbacks expose seed markers to the same writer. Stream observers receive the existing model dispatch; observer failure preserves its recorded partial attempt. None of these operations adds a model loop, permission authority or auxiliary writer.

Shutdown cancels admission, drains accepted operations and attempts every execution and retained epoch close. Independent failures aggregate after Agent identities and preset resources release. Lock acquisition and mutation retain their original error when release also fails, reporting both causes. Native and compatibility persistence Consumers use the same deletion operations, while the Client declaration leaf contains only receipt identities and operation types.

The change does not select a default SDK, Web or Desktop composition. Their transport-specific Consumers remain separate publication work. Read-only history helpers refuse missing, corrupt, future and excessive histories rather than returning a truncated or substituted Session.

All Agent release callbacks start before any drains. Failed lifecycle announcement rolls back its acquired preset lease, and resident child headers retain the selected preset for cold validation. One-shot writer closure remains mandatory after active-owner observer failure; primary and cleanup errors are reported together.

## Alternatives considered

A second continuation queue or writer would split ordered input ownership. Reconstructing live invocation from historical lineage would transfer authority across unrelated Program entries. Archive metadata cannot replace recoverable filesystem deletion.

## Verification

The focused owning cases use real NativeHost, JSONL persistence and the existing controlled model adapter. They cover maintenance without a model request, a resident child across parent closure and cold resume, independent close failure while another writer remains held, and retained-generation byte identity through cold restoration. Publication validation checks owning TypeScript programs and Cordis-free native entries; it does not claim every application carrier is migrated.
