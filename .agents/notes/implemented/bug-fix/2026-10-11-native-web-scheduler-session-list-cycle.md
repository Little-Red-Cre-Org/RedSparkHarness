# Agent Note: Native Web Session rows omit scheduler state

Status: implemented

English | [中文](2026-10-11-native-web-scheduler-session-list-cycle.zh.md)

## Problem

The Native Web Session controller provides `rootExecution`, and the `taskScheduler` Provider requires that service. The controller's optional `taskScheduler` dependency therefore formed a Host installation cycle.

## Decision

The Session controller does not select `taskScheduler` and reports `hasActiveSchedule: false` for every Session row. The scheduler remains selected in the `native-web` profile and uses the controller's root execution Provider.

## Alternatives considered

**Keep the optional dependency.** The dependency resolver includes selected optional Providers in activation order, so the scheduler and Session controller still form a cycle.

**Move rootExecution to another Provider.** This could preserve the Session-row indicator, but it requires extracting the Native Web executor from the Session controller. That change is outside this cycle repair.

## Verification

The native profile template test resolves the complete shipped Native Web Host plan before activation. The real profile smoke starts the Host through the `dsh` launcher and observes its loopback URL.

## Consequences

Native Web does not mark Sessions with active schedules. The task scheduler continues to execute and manage scheduled work through the selected root executor.
