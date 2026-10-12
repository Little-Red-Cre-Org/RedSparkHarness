# Agent Note: Native scheduled-task list

Status: implemented

English | [中文](2026-10-12-native-scheduled-task-list.zh.md)

## Problem

The Native Host exposes a read-only schedule feed, and the native sidebar needs a task list that stays current without exposing task prompts or unsupported management actions.

## Decision

The scheduled-tasks header action selects a keyed main panel. The panel consumes `clientNativeSchedule.follow()` while mounted, applies baseline, upsert, and remove frames, and aborts the feed on unmount.

Each row shows the task name, active/paused/failed state, stored schedule and time zone, and next run when available. The panel receives no task prompt or execution configuration and exposes no create, pause, resume, or delete action.

## Alternatives considered

- **Poll `list()` while the panel is open:** rejected because `follow()` supplies the baseline and subsequent changes without a polling interval.
- **Reuse the legacy SchedulerPanel:** rejected because it requires task mutation and execution data that the Native Host does not expose.
- **Keep the feed active for the whole sidebar lifetime:** rejected because the keyed panel owns the visible list and its stream lifetime.

## Consequences

The Native Schedule feed is active only while the list panel is mounted; closing the panel aborts its request. Native users can inspect schedule metadata but cannot manage tasks from this view.
