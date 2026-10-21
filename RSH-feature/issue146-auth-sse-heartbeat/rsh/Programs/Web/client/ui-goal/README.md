---
description: "Goal surface for the Web GUI: a composer strip for goal status and a read-only Native view of durable goal progress; for users and maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-goal

English | [中文](README.zh.md)

## Summary

The Web GUI goal surface shows both the durable goal state and its current process-local activation, and lets users edit, pause, resume, or clear the goal; rejected changes appear inline. It displays durable `/goal` runs as `Command input` bubbles so commands from users or the model remain visible after reload. Native consumers can render a read-only strip from the selected Session's durable goal and round history. Goal creation remains outside this package. Shipped Web presets other than `minimal` make `/goal` available to agents.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation` and the goal domain package; the strip then appears as the second card in the composer-context stack (after Todo, before Queue) whenever the session has a goal. An armed active goal offers pause; an active-but-disarmed or paused goal offers resume; edit rewrites the objective; clear removes the goal and suppresses the strip until the projection catches up.

### Native display

Import `NativeGoalBar` and `goalFromSessionEvents` from `@deepseek-ai/dsh-client-ui-goal/native`. The projection reads the selected Session's existing events and returns no goal before creation or after clear. The bar shows objective, durable phase, and admitted-round progress, including completed goals; it does not read process-local activation or perform goal operations.

### The command-input bubble

Each durable `/goal` run projects as a right-aligned user-style bubble labeled `Command input` (or `指令输入`), rendered before the generic command result row; the leading `/goal` token renders as a command reference chip in the code face through ui-primitives `projectUserText`, and the objective stays plain body text. It carries no timestamp, copy, or branch actions, and reloading reconstructs it from the run.

### Failures

A rejected mutation surfaces the Remote error inline on the strip; loading, absent, completed, and successfully cleared goals render nothing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Cordis entry reads the goal projection and process-local activation through its inject face; it owns the four mutation verbs and the `/goal` command-input Conversation Definition. The Native entry calls the goal domain's durable replay fold over the selected Session's event history and passes its result to a props-only bar.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the goal surface is not enough. They move from the browser strip to the goal domain and the slots it fills.

- [dsh-goal](../../../../Engine/goal/goal/README.md) — the goal domain, projection, and `/goal` command this surface reads and mutates.
- [native-application](../native-application/README.md) — the Native page that renders the read-only bar from loaded Session events.
- [ui-conversation](../ui-conversation/README.md) — declares the `conversation.input.dock` slot and owns the composer.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `goals/edit`, `goals/pause`, `goals/resume`, and `goals/clear` mutations the strip routes; the host GoalService owns the model-visible goal context message those mutations queue.

#### KV Cache effect

None unless the queued goal context is admitted. An admitted context extends the history tail like any other message; an insertion discarded before admission does not affect the cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current goal surface. They are current package constraints, not a goal-domain comparison or a task backlog.

- **Preset-independent host state** — switching an active session to `minimal` leaves its host-owned goal intact. `/goal` and goal tools disappear, while this strip can still edit, pause, resume, or clear the goal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No invariant companion is published. The Cordis entry owns one GoalBar dock registration; the Native entry reads only the selected Session's durable history. The [Native goal display decision](../../../../../.agents/notes/implemented/feature/2026-10-12-native-session-goal-display.md) records why the view omits mutation and activation data.
