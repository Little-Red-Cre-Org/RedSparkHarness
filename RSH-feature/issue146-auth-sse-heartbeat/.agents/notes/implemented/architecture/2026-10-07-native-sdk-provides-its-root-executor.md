# Agent Note: Native SDK provides its root executor

Status: implemented

English | [中文](2026-10-07-native-sdk-provides-its-root-executor.zh.md)

## Problem

Native SDK applications already create one `NativeHeadlessApplication` after `initialize`, but other installed Providers cannot resolve that Program's root execution service. A scheduler therefore cannot use the SDK-selected route without a second executor.

## Decision

The native SDK server provides `rootExecution` as a cancellable facade over its one initialized executor. `ready(signal)` waits for `initialize` to select that executor and rejects when the caller cancels. Other operations forward to the same executor and require readiness first. This adds no SDK wire method and does not enable scheduling unless a profile installs the Scheduler Provider.

The SDK server does not create a second `NativeHeadlessApplication` for installed Providers. Its own executor remains the authority for root identity, route configuration, Session writers, and execution.

## Alternatives considered

**Create another headless executor for the SDK's installed Providers.** This would split root identity, configuration, and writer ownership from the SDK server's executor.

**Reach into the SDK application's private executor.** This would bypass the native service graph and would not give Providers a declared readiness or ownership contract.

## Consequences

Providers may resolve the service during installation, but they must await `ready(signal)` before resolving routes or admitting work. Initialization failure, caller cancellation, and SDK shutdown reject pending readiness, so a Provider cannot hold application startup open. The SDK protocol remains unchanged.

The native SDK scheduled-origin snapshot exercises real SDK initialization, maintenance through the service, process close, and same-Session cold restore through both SDK clients.

The [native SDK Session-execution decision](2026-10-05-native-sdk-session-execution.md) continues to own the SDK process and Session lifecycle.
