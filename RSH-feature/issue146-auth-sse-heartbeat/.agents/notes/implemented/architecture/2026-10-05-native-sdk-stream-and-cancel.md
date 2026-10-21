# Agent Note: Native SDK stream projection and Session cancellation

Status: implemented

English | [中文](2026-10-05-native-sdk-stream-and-cancel.zh.md)

## Problem

Native SDK clients receive assistant events only after model settlement and can stop work only by closing the entire runtime.

## Decision

The native transport projects accepted StreamChunk values through session.chunk using the existing root observer. It adds session/cancel for the currently admitted turn, selected by exact Session identity. Before a durable prompt receipt or after settlement, cancellation returns false. TypeScript and Python expose matching Session and low-level client methods and continue collecting notifications through their existing subscriptions.

## Consequences

Cancellation awaits selected turn settlement; queued prompts and other Sessions remain independent. Stream notifications add no writer or durable log; completed messages and interrupted attempts reconstruct accepted chunks. The explicit native profile remains opt-in. Same-id cold resume remains supported; SDK Session forks are provided by the [fork projection](2026-10-05-native-sdk-fork.md).

## Alternatives considered

Closing the entire process cancels unrelated Sessions. Recording every live chunk adds a duplicate durable owner. The existing model observer and turn cancellation signal retain one executor and one Session log.
