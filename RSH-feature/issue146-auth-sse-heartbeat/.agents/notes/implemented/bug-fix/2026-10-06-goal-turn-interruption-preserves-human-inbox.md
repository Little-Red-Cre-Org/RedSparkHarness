# Agent Note: Goal turn interruption preserves human inbox input

Status: implemented

English | [中文](2026-10-06-goal-turn-interruption-preserves-human-inbox.zh.md)

## Problem

A host Goal pause or driver unload must stop automatic Goal work, but closing the full root epoch also discarded ordinary human messages that had not yet entered a model step. A Goal-owned turn can also admit direct human input at a later step, which authorizes a model-initiated pause to finish normally.

## Decision

The Native exact Program-bound root owner exposes `interruptTurn(reason)`, which aborts and awaits its current turn while keeping the Session epoch and unclaimed inbox messages. The command routes Native pause through the optional Goal driver; the driver interrupts only when it owns a current automatic Goal round and no direct human input entered that turn. A command-only profile durably pauses without canceling a human turn. Driver attachment rejects a Native root owner without `rootOperations.interruptTurn`, before installing hooks or scheduling Goal input. Driver unload disarms the Goal, interrupts and drains an admitted Goal turn, then removes its hooks. These paths do not open another writer or Agent loop.

The native SDK's public `session/steer` path persists ordinary human next-step input on the exact admitted root owner and wakes its parked ordinary driver. This does not rearm a paused Goal; only an explicit Goal resume admits another Goal round.

The Native Goal driver tracks the admitted Goal message and direct human messages accepted in that same turn. A model pause interrupts only a Goal-only automatic turn; if a human message enters a later step, the model may pause the Goal and complete the turn normally. Explicit Session and TUI cancellation keep using full root cancellation, which closes the epoch and discards its pending inbox.

## Alternatives considered

**Cancel the full root epoch for every Goal pause or unload.** Rejected: the Goal driver does not own ordinary inbox messages, so this also discards unrelated human input and closes the Program's root residency.

**Interrupt every turn after observing an admitted Goal message.** Rejected: a later direct human message can enter the same turn and authorize a model pause; Goal provenance alone does not identify the current turn's actor.

**Abort only the model request.** Rejected: the Program must settle the durable turn and await cleanup before another input can use its sole writer.

## Consequences

Goal pause and driver unload stop a current automatic Goal turn without canceling an unrelated human-owned turn or retracting ordinary unclaimed messages. A later public SDK steer wakes the parked root and exposes the retained and new human messages to the model while the Goal stays paused. Full Session cancellation retains its explicit discard behavior.

## Testing

Native Host regressions exercise driver unload, `/goal pause` followed by `/goal resume`, and model pause after a human message enters a later Goal-owned step. TypeScript and Python native SDK recorded-session twins also check Goal provenance, the nested aborted turn end, durable human-steer receipts and SDK event projections, retained input consumption after the public wake, cold restore with zero Goal admission until explicit resume, and the final response. These checks exercise `session/steer`; they do not establish concurrent `session/prompt` behavior, which remains serial per Session. All regressions check model abort signals, turn settlement, inbox retention, subsequent model requests, and durable Goal replay.
