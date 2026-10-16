# Agent Note: SDK Boot Failure Error

Status: implemented

English | [中文](2026-10-16-sdk-boot-failure-error.zh.md)

## Problem

The SDK JSON-RPC server plugin runs inside the profile's Loader tree. When another entry fails during startup, for example two filesystem providers both registering service `fs`, the Loader removes the failed entries and rolls back the tree, disposing the server's context. The `initialize` readiness wait still resolved, so the handler created effects on the disposed context and the SDK client received `cannot create effect on inactive context` instead of the startup failure.

## Decision

On apply, [`dsh-sdk-jsonrpc-server`](../../../../rsh/Programs/SDK/packages/server/README.md) watches the pending Loader entry tasks until the tree settles and keeps the last rejected entry; `entries()` yields parents before children, so this is the failing leaf entry. `initialize` waits for this watch. After a failure, `initialize` and any request handled later reject with `SDK runtime failed to start: loader entry "<id>" (<plugin>) failed: <ErrorType>[: service "<name>" is already provided by another plugin]; see the runtime stderr log for details`.

The message carries only the entry id, plugin name, error type, and the recognized Cordis duplicate-service rule. It never includes the plugin's message, stack, or cause, because those can contain configuration values; app-boot still prints the full error to stderr.

## Alternatives considered

**Report the failure from app-boot through a launcher service.** Rejected because it needs new contracts across the CLI, cmdline, app-boot, and SDK packages, while the server can read the same entry failures from the Loader it already waits on.

**Make a name-mismatched cordis.yml patch an error.** Not done here. The vendored include skips such a patch with a warning so one overlay can serve several trees; changing that is a separate vendor decision.

## Consequences

A misconfigured SDK profile now fails the SDK start call with the failing entry and cause. Requests that arrive after the transport closes during rollback get no response; the client then reports the closed transport with the stderr tail.

## Verification

`rsh/Programs/SDK/packages/server/tests/plugin-apply.spec.ts` boots a Loader group containing the server and two `fs` providers, sends `initialize` during startup, and checks the duplicate-service error. A second case throws an error whose message contains a fake secret and checks that only the error type reaches the client.
