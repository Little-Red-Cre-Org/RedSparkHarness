# Agent Note: Native jobs retain producer-observed live output

Status: implemented

English | [中文](2026-10-05-native-job-live-output.zh.md)

## Problem

Native job controls need real output before a background runner finishes. PTY output already passes through the shared sanitizer, but the native registry only receives the final display.

## Decision

The selected native Jobs registry supplies each runner with a text publisher. The existing UTF-8 TextRetainer bounds a configurable per-job tail. Reads do not consume text; cancellation or settlement deactivates publication. Runner settlement still follows owned cleanup, and an explicit final output replaces the live display while preserving producer truncation facts.

The shared PTY send operation notifies its request observer when sanitized text arrives, without consuming its viewport. The native terminal runner publishes that text directly. No timer, progress estimate or second job registry is introduced. Other runners can supply final output without a live publisher.

The existing job_output value tool reads retained output, includes truncation metadata, and preserves the status line within its presentation budget. The application records the selected ToolResult in the sole Session before the next model request; uncollected output is not model-visible and needs no separate event stream.

## Consequences

Repeated reads can repeat retained text. PTY retention and final formatting remain bounded by their own budgets; omitted text is marked rather than represented as complete. Jobs still require cooperative cancellation and cannot outlive their exact Agent owner.

## Alternatives considered

Polling a PTY would consume its viewport or add another output owner. Recording every asynchronous chunk would create an unnecessary durable stream for text the model has not read. Direct publication and ordinary tool collection retain the existing ownership and Session rules.
