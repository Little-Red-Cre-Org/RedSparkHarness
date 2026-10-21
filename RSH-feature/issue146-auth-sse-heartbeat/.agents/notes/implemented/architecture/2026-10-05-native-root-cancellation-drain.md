# Agent Note: Native root cancellation drains retained work

Status: implemented

English | [中文](2026-10-05-native-root-cancellation-drain.zh.md)

## Problem

A failed initial root turn could leave a retained Session epoch open. An already aborted settlement signal rejected before closing that epoch, leaving its writer and lifecycle Consumers resident.

## Decision

The root executor closes the captured epoch after initial-turn failure and awaits the existing activation cleanup transaction. Settlement selects the epoch before responding to cancellation. A simultaneous execution and cleanup failure produces an AggregateError containing both errors.

## Consequences

Program callers receive cancellation only after retained work drains. Session ownership remains with the existing activation; no additional cleanup registry or writer is introduced.

## Alternatives considered

Caller-owned cleanup would duplicate the Engine's lifecycle authority and could affect unrelated Sessions.
