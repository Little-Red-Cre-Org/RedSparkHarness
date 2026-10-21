# Agent Note: Terminal human cancellation closes its exact root

Status: implemented

English | [中文](2026-10-05-native-terminal-owned-root-cancellation.zh.md)

## Problem

A terminal can display an approval or question from work admitted by another Consumer of its selected executor. Such work has no local terminal turn controller, so aborting only local input leaves the real request running. A Session id alone cannot establish Program ownership.

## Decision

Answerers resolve the selected executor's exact live interaction recipient and attached root owner before presentation. The root execution capability closes that owner's original Agent epoch through its existing unregister transaction. Terminal cancellation observes the Provider's real abort cause, blocks admission until drain completes and preserves cleanup failure. The executor removes a closed execution entry only after successful cleanup; failure prevents replacement while resource release is uncertain.

## Alternatives considered

Rejecting the presentation supplies no execution cancellation. Aborted settlement alone cannot cancel an ordinary turn without retained residency. Creating artificial retention would still leave the original turn uncancelled. Cancelling by Session id could affect another Program; another registry would duplicate execution ownership.

## Consequences

Human cancellation closes the whole root Agent epoch, including retained work. A later input resumes recorded history through a new Agent epoch. Foreign, delegated and released owners are refused. The terminal exits on cleanup failure and exposes the original error. Existing Session events, audit Providers and legacy defaults remain unchanged.
