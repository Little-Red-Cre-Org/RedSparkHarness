# Agent Note: Native goal display reads durable Session events

Status: implemented

English | [中文](2026-10-12-native-session-goal-display.zh.md)

## Problem

The Native Web page needs to show a Session's current goal without adding a Host operation or coupling its Client package to the Cordis goal controls.

## Decision

`ui-goal/native` uses the goal domain's `foldGoal` over the selected `native-application` controller's Session events. The props-only bar displays the objective, durable phase, and admitted-round progress, including completed goals. A clear leaves no current goal. The view does not read process-local activation or issue goal operations. The durable goal model remains owned by the [same-session goal decision](2026-07-16-harness-level-loop.md).

## Alternatives considered

- **Read a Host goal endpoint.** The controller already holds the durable events needed for this display, so another read would duplicate the Session authority.
- **Reuse the Cordis GoalBar.** Its actions and activation hook require the legacy Remote and renderer, which the Native page does not use.
- **Add a Native-owned goal fold.** The goal package already defines durable mutation and round-attribution replay rules; a second fold could drift from them.

## Consequences

- The Native bar updates from the selected Session history and live event list without a Host API or a second goal store.
- The bar shows only durable objective, phase, and round count; activation, mutation actions, and `/goal` command input remain outside the Native view.
- `native-application` pins the visible goal and admitted-round count in one history-backed component test.
