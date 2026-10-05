# Agent Note: Native ACP Session carrier

Status: implemented

English | [中文](2026-10-05-native-acp-session-carrier.zh.md)

## Problem

The explicit `native-acp` profile names a missing application and inherits native module declarations unavailable on a clean production tree. Standard ACP callers need a working native carrier while remaining compatibility features are migrated separately.

## Decision

The native ACP application uses the maintained ACP SDK for wire validation and stdio framing and the shared native-headless executor for all model, Agent, Tools, and Session work. Each connection-owned Session has its own workspace route and cancellation controller; durable storage owns Session identities and history. New Sessions materialize before acknowledgement, resume replays committed updates, and close releases execution without deleting history. Transport termination cancels accepted prompts and waits for executor teardown.

The shipped native ACP profile uses the proven SDK carrier providers and keeps compatibility ACP selection unchanged. Text prompts, durable assistant/tool updates, cancellation, close, list, and resume are supported. Per-session MCP mounts, multimodal admission, mutable model controls, permission/question channels, and attachment presentation remain separate parity batches. Unsupported MCP declarations and prompt content reject explicitly, and the capability response advertises the supported input.

## Alternatives considered

**A protocol-owned Agent loop.** This duplicates writer and model admission ownership already provided by native-headless.

**Advertising complete ACP parity.** Unavailable modules and interaction channels would fail after clients relied on their capability declaration, so native selection remains explicit.

## Consequences

ACP clients can exercise native persistent Session turns through the supported `dsh` launcher without Cordis boot. A recorded Session protocol snapshot verifies ordered replies and durable replay; focused lifecycle verification covers prompt cancellation and transport drain. Default switching belongs to the later parity milestone.
