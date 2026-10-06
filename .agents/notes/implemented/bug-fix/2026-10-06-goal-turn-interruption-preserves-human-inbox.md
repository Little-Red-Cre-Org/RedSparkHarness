# Agent Note: Goal turn interruption preserves human inbox input

Status: implemented

English | [中文](2026-10-06-goal-turn-interruption-preserves-human-inbox.zh.md)

## Problem

A host Goal pause or driver unload must stop automatic Goal work, but closing the full root epoch also discarded ordinary human messages that had not yet entered a model step. A Goal-owned turn can also admit direct human input at a later step, which authorizes a model-initiated pause to finish normally.

## Decision

The Native exact Program-bound root owner exposes `interruptTurn(reason)`, which aborts and awaits its current turn while keeping the Session epoch and unclaimed inbox messages. Native `/goal pause` durably pauses first, then interrupts that root turn while retaining the owner through settlement. Native driver unload disarms the Goal, interrupts and drains an admitted Goal turn, then removes its hooks. Neither path opens another writer or Agent loop.

The Native Goal driver tracks the admitted Goal message and direct human messages accepted in that same turn. A model pause interrupts only a Goal-only automatic turn; if a human message enters a later step, the model may pause the Goal and complete the turn normally. Explicit Session and TUI cancellation keep using full root cancellation, which closes the epoch and discards its pending inbox.

## Alternatives considered

**Cancel the full root epoch for every Goal pause or unload.** Rejected: the Goal driver does not own ordinary inbox messages, so this also discards unrelated human input and closes the Program's root residency.

**Interrupt every turn after observing an admitted Goal message.** Rejected: a later direct human message can enter the same turn and authorize a model pause; Goal provenance alone does not identify the current turn's actor.

**Abort only the model request.** Rejected: the Program must settle the durable turn and await cleanup before another input can use its sole writer.

## Consequences

Goal pause and driver unload stop the current Goal turn without retracting ordinary unclaimed messages. A later wake reuses the same root owner and exposes those messages to the model. Full Session cancellation retains its explicit discard behavior.

## Testing

Native Host regressions exercise driver unload, `/goal pause` followed by `/goal resume`, and model pause after a human message enters a later Goal-owned step. They check model abort signals, turn settlement, inbox retention, subsequent model requests, and durable Goal replay.
