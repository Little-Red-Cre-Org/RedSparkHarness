---
description: "Interactive terminal conversations through explicit native profiles."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-tui

English | [中文](README.zh.md)

## Summary

The native terminal supports multiple conversation turns, live output and file tool results. Users can queue input, stop a turn and resume the same durable conversation. Launch requires an interactive terminal and an explicit native Provider composition.

## Table of Contents

- [Use and configuration](#configuration)
- [Implementation](#implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration"></a>
## Use and configuration

The `./native` entry is assembled by `dsh --profile native-tui`. It uses the [shared executor configuration](../../../Engine/core/native-headless/README.md#configuration) and requires `locale` (`en` or `zh`), `background` (`#rrggbb`), and positive safe integers `maxQueuedInputs`, `maxHistoryEvents`, `maxTranscriptEvents`, `maxStreamChunks`, and `maxPendingHumanRequests`. History reads exceeding their limit fail; presentation and streamed chunks retain their configured recent counts.

New conversations accept no positional arguments; `--resume <session-id>` opens the same conversation. Enter queues input. Outside a human request, Esc stops the active turn and sends a nonempty draft. Ctrl+C stops while busy or exits while idle. `/help`, `/model`, `/reasoning`, `/clear`, `/retry`, `/exit`, and `/quit` are available; other commands report an error. `/clear` affects only the view. Stopping discards unstarted input; exit cancels and drains accepted execution before withdrawing Ink. Ink is withdrawn even when execution cleanup rejects; simultaneous execution and terminal cleanup failures remain in an `AggregateError`.

The shipped profile installs `modelSelection`; its adapter provides `modelDirectory`. `/model` reads advertised models and isolated Provider failures; `/reasoning` reads the selected model's actual efforts. Enter a displayed number to commit the complete choice, or Esc to dismiss. Both require an idle terminal without queued input. Selections compare the observed durable revision under the shared executor's exclusive Session maintenance and persist before affecting the next turn. Cold restore retains the choice. The header shows the selected route and effective effort; input modalities and context capacity come from the actual Provider, with unknown metadata marked explicitly. Custom compositions without both Providers report unavailable controls.

Tool approvals offer `/allow` for one operation or `/deny`; model questions accept numbered single/multiple choices, free text without options, or `/other text`. The exact active root Session owns each request. The terminal only presents a bounded FIFO and refuses stale renderer answers; the existing executor writes approval audits and question tool results. During a human request, Esc cancels the turn and retains the unsubmitted draft; Enter after settlement submits that draft as new input. Exit withdraws pending input before execution drain. Other Sessions and delegated requests retain their existing answerer chain. Question and approval controls require their selected Providers; no permission preset, policy change or persistent grant is implied.

<a id="implementation"></a>
## Implementation

<details>
<summary>Implementation internals</summary>

The [bootstrap](src/native.ts) assembles Ink; the [controller](src/controller.ts) owns input admission, restore and settlement. It passes the selected `sessionExecution` and `activeSessions` Providers to the shared executor; the terminal creates no second writer. Completed rows originate in durable events, while temporary stream frames only affect presentation. The [presentation library](../terminal-ui/README.md) also serves the compatibility terminal. No invariant companion is published: queue and view have no independent observers; Session and its Providers own durable consistency validation.

</details>

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [shared native executor](../../../Engine/core/native-headless/README.md#model-experience); the terminal adds no prompts, tools or durable event types.

#### KV Cache effect

Presentation and input admission do not rewrite recorded model prefixes; the executor owns cache-relevant request changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Preset and permission selectors, Plan/Todo panels, contributed commands and a Session browser are not connected.
- The view shows recent message rows without history scrolling; large streamed output is presentation-limited while complete accepted output remains in Session.
- The complete `native-tui` template depends on native entries owned by other modules; standalone terminal evidence uses explicit filesystem and external model Providers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
