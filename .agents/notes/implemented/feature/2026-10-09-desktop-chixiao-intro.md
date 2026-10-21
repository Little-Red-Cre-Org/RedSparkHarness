# Agent Note: Keep the cold-start intro separate from Host readiness

Status: implemented

English | [中文](2026-10-09-desktop-chixiao-intro.zh.md)

## Problem

The selected 赤霄初耀 animation must remain visible for a short opening without serializing Host startup, obscuring failures, or replaying inside the application. Renderer reloads cannot reset process-wide playback eligibility.

## Decision

The Electron main process owns available, playing, and finished intro states. The primary startup document claims playback through restricted IPC. Completion or SKIP releases the presentation; navigation requires both release and actual Host readiness. Errors, window closure, and emergency recovery consume playback. A second claim releases a previous renderer's unfinished presentation instead of replaying it.

The shell renderer owns the 5.5-second timer, Escape, image decoding, and reduced-motion handling. It removes its timer and subscription on pagehide, and late decoding cannot revive a dismissed intro. Failed artwork decoding releases the presentation. Typed shell locales own text and accessibility names; the brand is 赤霄初耀 and the mascot is 赤绯. Bundled artwork uses the selected blade lettering and orbital corner mark.

This qualifies the ready-to-navigate condition in the [immediate-window decision](../architecture/2026-09-09-desktop-immediate-window-and-direct-start.md). That note remains authoritative for window creation, profile preparation, and recovery. Host and IDE ownership are unchanged.

## Alternatives considered

**Navigate immediately on Host readiness.** Fast startup truncates the approved opening; the renderer's completion and Host readiness are independent observations.

**Wait for the animation before starting the Host.** This adds the full opening duration to backend latency and delays actionable startup failures.

## Consequences

Startup remains interactive through SKIP and recovery. The application has no animation replay or configuration entry. Shell renderer snapshots and lifecycle tests cover text, completion, cancellation, errors, readiness gating, and sender restrictions. The supplied character sheet still contains poster lettering; the selected wordmark is raster artwork, not a delivered vector master. Release packaging and the installed application's GUI remain separate validation steps.
