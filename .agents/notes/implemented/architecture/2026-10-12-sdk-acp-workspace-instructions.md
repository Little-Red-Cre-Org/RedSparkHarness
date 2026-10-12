# Agent Note: Load workspace instructions in native SDK and ACP profiles

Status: implemented

English | [中文](2026-10-12-sdk-acp-workspace-instructions.zh.md)

## Problem

The Cordis base and native headless profiles load workspace instructions into the durable Session, but the shipped native SDK, SDK-child and ACP compositions omitted the existing provider. The same workspace therefore supplied different model-visible guidance through these supported runtimes.

## Decision

Install `@deepseek-ai/dsh-agent-instructions` with a 65,536-byte budget in the shared `native-sdk`, `native-sdk-dsh-child` and `native-acp` profile composition. The provider uses the active Session cwd and the composition's selected `fs` Provider for root discovery, metadata probes and content reads. Native Headless remains the only Session writer.

The provider's discovery and durable-reconciliation behavior remains defined by the [native workspace-instructions decision](2026-10-05-native-workspace-instructions.md).

The SDK child launcher supplies the requested workspace cwd and a private DSH_HOME. Its actual child process uses the `native-sdk` profile and selected `fs-local` Provider, while the launcher runs that process under its selected child process sandbox policy; it does not copy the parent's full history or global instruction files into the child home. The opt-in `native-sdk-dsh-child` parent profile uses `fs-sandbox`, whose `workspace-write` policy fences writes and edits but does not confine reads. Instruction discovery uses the Provider selected by each process and makes no read-confinement promise.

## Alternatives considered

Leaving instructions opt-in would preserve the existing omission but retain the runtime parity gap. Copying parent messages or global files into an SDK child would mix separate Session and home ownership, so the child resolves workspace instructions for its own Session instead.

## Consequences

The applicable instruction baseline becomes one durable `user/message` in the existing Session log and is reused on compatible resume. These profiles spend model input tokens on the retained guidance up to the configured budget. The SDK clients and ACP wire protocol keep their existing event and prompt formats; they observe the same Native Headless Session events. No time-context provider, Session writer, external-operation projection, or client UI behavior changes.
