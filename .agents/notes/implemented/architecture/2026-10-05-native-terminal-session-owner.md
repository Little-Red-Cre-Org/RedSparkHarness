# Agent Note: Native terminal Session ownership

Status: implemented

English | [中文](2026-10-05-native-terminal-session-owner.zh.md)

## Problem

An interactive native terminal needs resume and cancellation without duplicating Session execution ownership.

## Decision

The native terminal admits bounded identified inputs through the selected Session execution Provider and the shared native executor. It owns presentation and input cancellation; it never owns a second Agent loop or writer. Accepted durable events supply completed transcript rows. Cancellation waits for model settlement; ordinary exit drains accepted work before unmounting Ink.

## Alternatives considered

Copying the compatibility runner would retain Cordis ownership and duplicate execution. Shared Ink presentation remains a library; the native Program supplies its own narrow input port. Selectors and policy panels require their own native Consumers and remain outside this first interactive closure.

## Consequences

An independent controller owns input admission, cancellation, restore and drain; the existing terminal lifecycle case directly exercises its parameterized execution intervals, retaining per-file business coverage. Real TTY and Session snapshots verify subprocess interaction; only the thin Ink bootstrap and pure presentation unobservable to unit-process V8 use owner-local exclusions. Shared presentation retains compatibility tests and adds no model state.

## Verification

One keyless real dsh terminal scene covers a tool result, queued multi-turn input and cold resume of the same Session. One real TTY regression holds model cleanup after cancellation and proves ordinary exit waits for release. Existing compatibility presentation tests cover shared formatting and filtering.
