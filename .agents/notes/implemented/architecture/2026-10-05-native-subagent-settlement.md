# Agent Note: Native child settlement admission

Status: implemented

English | [中文](2026-10-05-native-subagent-settlement.zh.md)

## Problem

A continuable child's last turn can finish before its writer and Agent cleanup, and a cold epoch must not reuse an earlier answer. Its parent can start another turn while settlement reaches inbox admission; placing that notice behind a turn waiting for it prevents progress.

## Decision

The Provider uses the Program's existing onSettled callback after actual cleanup. Accepted-work accounting and final assistant selection fold only this residency's durable suffix. Cleanup failure reports error without output. Shared protocol helpers produce the same runtime-owned subagent-settled attribution as the compatibility implementation.

Busy Program recipients admit through their exact active owner when it attaches, or through existing idle execution after current work settles. One synchronous claim selects the admission; a live owner cancels and drains the still-queued alternative. The attachment listener never waits for work queued behind its own turn. Admission failure preserves its cause rather than retrying another writer.

## Alternatives considered

A turn/end or owner detach does not establish cleanup success. Copying child history creates another authority. Queuing every notice after busy execution deadlocks parents awaiting that notice. Waking SDK roots without a user turn adds an unowned response projection.

## Consequences

Root parents consume notices on the next user turn; resident continuable parents retain existing wake semantics. Shutdown suppresses new notices while draining owned children. Session and inbox ownership remains Program-owned. The native SDK separately projects actual Provider settlement as `subagent.finished`, including accepted child epochs settled during shutdown; the wire event does not deliver or wake a parent. ACP projection and catalogs remain separate capabilities. [Continuation admission](2026-10-05-native-subagent-continuation.md) and [compatibility conversations](../feature/2026-07-28-continuable-subagent-conversations.md) retain their routing, permissions and lifecycle rationale.
