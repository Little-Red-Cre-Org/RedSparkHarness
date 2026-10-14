# Agent Note: Native Credential Service Notifications

Status: implemented

English | [中文](2026-10-14-native-credential-service-notifications.zh.md)

## Problem

The Native credentials Provider dispatched `credentials/record-updated` at its own scope. Native event delivery selects listeners whose scope contains the dispatch scope, so a child consumer did not receive a parent Provider's commit. Authorization then reported `NOT_COMMITTED`, and `llm-pi-ai` kept stale account-route state.

## Decision

Native record notifications belong to the selected `credentials` service instance. `NativeCredentials.onRecordUpdated` passes only the branded record key. The Provider invokes listeners synchronously after a durable write, removal, or adopted external change; it contains and logs listener failures without waiting for asynchronous work. Its idempotent disposer stops new delivery and drains admitted callbacks, and Native consumers register it through `context.effect`.

The Native authorization consumer marks `observedCommit` synchronously before the credential write resolves and still checks `describeRecord` after the flow returns. The LLM consumer uses the same selected service to invalidate its adapter and refresh account routes. Cordis keeps the `credentials/record-updated` event, and Native reference notifications keep their existing event path.

## Alternatives considered

**Expand Native Runtime event visibility.** Making parent dispatches reach child listeners changes event visibility for every Native event, while this defect belongs to the credentials capability.

**Defer or await listener callbacks.** Deferring would allow the credential write to resolve before authorization observes its commit. Awaiting async listeners would tie the durable write result to adapter refresh and other consumer work.

**Move consumers to the root scope.** That would hide the mismatch and ignore which credentials Provider a scoped consumer actually selects, including a nearer shadowing Provider.

## Consequences

Native consumers receive changes from the exact Provider chosen by Native scope resolution, including a parent Provider used by a child and a nearer Provider used by its own descendants. Record keys cross the callback; secret payloads do not. Async consumer work remains independent of write completion, while provider and owner teardown drain callbacks already in progress. Authorization cancellation and key-drain semantics remain as described in [Native authorization attempts drain before releasing their key](../architecture/2026-10-09-native-authorization-drain.md). Cordis event behavior remains separate.
