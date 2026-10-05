# Agent Note: Native terminal interaction

Status: implemented

English | [中文](2026-10-05-native-terminal-interaction.zh.md)

## Problem

Native terminal users need persistent input, bounded retained output and foreground process signals. Maintaining a second PTY implementation would separate readiness and cancellation semantics from the existing shell backend.

## Decision

Native and Cordis backends share `LocalPtySession`, the sanitizer and startup preparation. The terminal protocol and machine-routable errors are independent exports; configuration uses the same shell defaults and validated output and readiness budgets.

The native registry admits interaction only for the exact live Agent and an owned, open session. Owner and backend cancellation reach active sends, and teardown awaits the existing backend close. Named sessions reserve owner-local names before allocation and release them after failed setup or successful close.

The native Consumer exposes all six tools with bounded text and persisted send metadata. Foreground cancellation interrupts its request-owned send. Background sends use the selected NativeJobs Provider and its Agent cleanup; a missing Provider fails installation when background sends are enabled.

## Consequences

No terminal mechanics are duplicated. Native policy mode is fixed for the installation; mutable per-Session native sandbox mode is not supplied. Windows ConPTY retains the selected subprocess Provider's documented weaker containment.

NativeJobs exposes final output, while live retained terminal output remains available through terminal_read. Incremental native job-output collection is not supplied by this change. Durable tool results reconstruct model-visible terminal text; live PTYs cannot survive a process restart.

## Alternatives considered

A native PTY engine or background read worker would introduce separate readiness and cleanup owners. Reusing the existing operation and native Jobs cancellation keeps terminal reads synchronous and bounded by the selected Provider.
