# Agent Note: Replaying step-boundary runtime changes on a Native profile

Status: implemented

English | [中文](2026-11-11-native-step-boundary-changes.zh.md)

## Problem

Two recordings change the runtime's inputs *between* steps of one turn, and neither could be replayed on a Native profile.

`system-prompt-in-history` asserts that a route declaring `systemPromptUpdate: 'in-history'` appends a fresh `system/message` after cached history when the rendered prompt changes, instead of replacing node 0. Two things prevented it. The Native loop rendered the prompt sections **once per run**, so a section that changed mid-turn was never observed; and nothing read the route's `systemPromptUpdate` capability, so even an observed change had nowhere to go. The replay Provider also stopped short of forwarding that capability to the resolved model, although its Cordis entry already did.

`model-switch-notice` changes the selected model after a `todo_write`. The Native loop already re-reads the selection at each step, so the switching mechanism existed — but it reads through `modelSelection`, which requires `modelDirectory`, which the replay Provider does not publish.

## Decision

The loop re-renders the prompt sections at each step boundary, and on an `in-history` route appends the changed prompt after the cached one. The replay Provider forwards `systemPromptUpdate` from its configured models, matching what its Cordis entry already did.

The route directory for the model-switch scenario is a **scenario-local plugin**, not a widening of the replay Provider. Widening the Provider changes the composition every Native scenario shares, and it broke all of them at once when tried: a profile row declares its published services in its manifest, so adding one to a shared Provider rewrites an agreement that dozens of scenarios rely on. A scenario that needs an extra service supplies it, and leaves the shared Provider alone.

## Consequences

Both recordings replay through a Native profile with their own assertions: the in-history scenario counts the two system records and the guidance the fixture adds after the read; the model-switch scenario asserts the two request headers and contexts carry the two routes in order.

The scenario also composes `tool-todo` explicitly. It was absent before, and `todo_write` still appeared to work because nothing asserted it — a reminder that a scenario whose subject is a tool call must compose that tool, not inherit it by assumption.

## Alternatives considered

**Widen the replay Provider to publish `modelDirectory`.** Rejected after measuring the damage: every Native scenario failed with `entry provides differs from manifest`, because a shared Provider's published services are part of each row's declared agreement.

**Read the turn from a session projection for the in-history case.** Rejected: the projection reports the open turn, not whether the route wants the changed prompt appended; the route capability is the authority.

**Render the sections once and cache the result.** Rejected: the recording's subject is precisely that the rendered prompt changes between steps, so caching would erase the behaviour under test.
