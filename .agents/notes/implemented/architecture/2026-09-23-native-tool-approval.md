# Agent Note: Native tool approval and Session audit ownership

Status: implemented

English | [中文](2026-09-23-native-tool-approval.zh.md)

## Problem

Native headless can execute fixed and contributed tools under a live Agent, but it had no native policy service that could stop a sensitive operation and no durable record linking a decision to the tool call it affected.

## Decision

`@deepseek-ai/dsh-native-approval` provides the native `approval` service. It accepts a deployment `ask` or `never` policy, verifies the exact registered native Agent, dispatches ordered answerers under `ask`, and returns the caller-supplied request id with one closed outcome. The Session owner durably appends the `native-approval/asked` event before dispatch. Missing and failed answerers resolve unavailable; cancellation resolves cancelled; only allowed-once permits the pending action. Provider disposal rejects new requests, aborts answerer work, and waits for it to settle.

`@deepseek-ai/dsh-approval-definition` owns the framework-free native service contract and a separate `/legacy` contract for compatibility audit and policy events. The Cordis `dsh-user-approval` adapter specializes `ApprovalServiceDefinition<Agent>` with the full existing Agent type, retaining its Session and scoped injection behavior. Its `Session` imports use the Cordis-free Session entry; no Cordis dependency enters the Definition package.

The provider does not write a Session. Native headless owns the Session and records `native-approval/asked` before dispatch, then durably records the matching `native-approval/decided` before an approved operation and its tool result. It applies the service to fixed `write_file` calls when the provider is installed, and passes the same authorization callback to native tool contributions. A contribution may declare an approval reason; the registry invokes the callback before its executor and refuses a protected contribution when no approval authority is available.

The native audit names are separate from `approval/asked` and `approval/decided`, whose payloads and Cordis Agent semantics belong to the existing user-approval service. The Session persistence catalog includes the native names, so current readers recognize the native profile's durable records without reinterpreting legacy approval data.

## Alternatives considered

**Reuse the Cordis user-approval service:** It requires a Cordis Agent and session-owned audit path that native profiles do not construct.

**Let the approval Provider append Session events:** It would make a policy service a second writer for an application-owned Session and obscure the ordering with its tool result.

**Put approval handling in every tool contribution:** Policy, answerer order, cancellation, and durable auditing would diverge across contributions and fixed tools.

## Consequences

Headless profiles can remain unattended without the Provider: fixed writes retain their existing behavior, while a protected contributed tool fails explicitly because it has declared an unavailable authority. Installing `never` gives an auditable deterministic refusal; installing `ask` requires an answerer for a grant. The provider has no browser presentation or protocol transport, and native approval data is not a substitute for the legacy approval history.

## Verification

Native approval tests cover ordered delegation, absent answerers, exact Agent identity, never-policy rejection, synchronous callback failure, caller cancellation, and Provider disposal aborting and awaiting answerer work. Native headless tests cover durable rejected-write audits, protected-contribution refusal, and durable question-before-dispatch and grant-before-execution ordering.
