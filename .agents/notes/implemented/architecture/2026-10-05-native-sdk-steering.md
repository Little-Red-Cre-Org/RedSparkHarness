# Agent Note: Native SDK next-step steering

Status: implemented

English | [中文](2026-10-05-native-sdk-steering.zh.md)

## Problem

The native SDK queues ordinary prompts after the preceding turn settles. Callers cannot submit input to the existing next-step inbox while a model dispatch is running.

## Decision

The native-only session/steer method and both SDKs send ordered content through the selected Attachment Provider, then the Program's exact active root owner enqueues it for next-step without waking another driver. The original admitted turn owns events and cancellation. Admission checks that turn and root route before upload and rechecks the original owner after upload; cancellation and owner release refuse late input. The response follows the sole writer's durability barrier.

## Alternatives considered

Cancelling the current dispatch to restart a new turn would alter steering behavior and discard accepted output. A transport-owned queue would duplicate the durable inbox and lose input on restart. The existing active Session capability supplies both ownership and persistence.

## Consequences

Steering never creates a Session or promises a model reply. If no further step starts before settlement, accepted next-step input remains durable for a resumed turn. Ordinary prompt ordering remains unchanged. One existing scenario sends steering during a held model stream, rejects unknown and idle targets, cancels, and restores the recorded input through both SDKs.
