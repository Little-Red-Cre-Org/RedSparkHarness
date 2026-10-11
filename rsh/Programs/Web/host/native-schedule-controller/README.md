---
description: "Expose Native scheduled task metadata to the browser through authenticated RPC and live schedule updates."
kind: "package-reference"
---

# Native schedule controller

English | [中文](README.zh.md)

## Summary

The Native Web application can list active, paused, and failed scheduled work and follow committed changes. Schedule rows omit prompts and captured execution configuration. The application must install the task scheduler and this controller.

## Table of Contents

- [Reference](#reference)
- [Invariants](#invariants)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="reference"></a>
## Reference

The Native Web profile installs this controller after `task-scheduler`. It requires the Host Connection and the Native scheduler service.

`schedules/list` returns active, paused, and failed plans. `schedules/follow` is an authenticated POST Fetch route that sends an SSE baseline followed by changed rows and removals. The stream reads committed scheduler state; it carries no task prompts or execution configuration.

`schedule` contains the stored RFC 3339 start time and, for repeating work, its fixed elapsed-time interval. `timeZone` preserves that timestamp's explicit UTC offset as `UTC±HH:mm`, or `UTC` for `Z` and `+00:00`. The list omits completed one-shot plans.

Failures use `native/schedules` with a generic message. The Client Consumer is `clientNativeSchedule` from [Native Session](../../client/native-session/README.md).

<a id="invariants"></a>
## Invariants

No runtime invariant companion is published because this controller reads the scheduler's committed plan and receipt state without maintaining a second copy.

<a id="dev-note"></a>
## Dev Note

The task scheduler owns persistence and schedule execution. This package owns the authenticated browser projection.

<a id="model-experience"></a>
## Model Experience

### Native Host

#### What the model sees

Nothing from this package: `schedules/list` and `schedules/follow` are browser-only RPCs and add no model-facing input or tools.

#### Token effect

No model request content is created here.

#### KV Cache effect

No model request content is created here.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This controller only reads schedules; it does not create, pause, resume, or delete plans.
