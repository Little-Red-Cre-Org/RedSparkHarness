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

New conversations accept no positional arguments; `--resume <session-id>` opens the same conversation. Enter queues input. Outside a human request, Esc stops the active turn and sends a nonempty draft. Ctrl+C stops while busy or exits while idle. `/help`, `/sessions`, `/mode`, `/model`, `/reasoning`, `/clear`, `/retry`, `/exit`, and `/quit` are available; other commands report an error. `/clear` affects only the view. Stopping discards unstarted input; exit cancels and drains accepted execution before withdrawing Ink. Ink is withdrawn even when execution cleanup rejects; simultaneous execution and terminal cleanup failures remain in an `AggregateError`.

The shipped profile installs `modelSelection`; its adapter provides `modelDirectory`. `/model` reads advertised models and isolated Provider failures; `/reasoning` reads the selected model's actual efforts. Enter a displayed number to commit the complete choice, or Esc to dismiss. Both require an idle terminal without queued input. Selections compare the observed durable revision under the shared executor's exclusive Session maintenance and persist before affecting the next turn. Cold restore retains the choice. The header shows the selected route and effective effort; input modalities and context capacity come from the actual Provider, with unknown metadata marked explicitly. Custom compositions without both Providers report unavailable controls.

Tool approvals offer `/allow` for one operation or `/deny`; model questions accept numbered single/multiple choices, free text without options, or `/other text`. The exact active root Session and its selected Program own each request. The terminal only presents a bounded FIFO and refuses stale renderer answers; the existing executor writes approval audits and question tool results. During a human request, Esc closes that exact root Agent epoch and retains the unsubmitted draft, including when another Consumer admitted the work. Input and selectors remain blocked until its execution and writer finish draining; subsequent input resumes durable history through a new Agent epoch. Cleanup failure closes the terminal with the original error. Exit withdraws pending input before execution drain. Other Programs, Sessions and delegated requests retain their existing answerer chain. Question and approval controls require their selected Providers; no permission preset, policy change or persistent grant is implied.

`/sessions` lists stored Session identities in the configured workspace while the terminal is idle and has no queued input or pending human request. Enter a displayed number to restore that Session through the existing executor, or Esc to dismiss. A human request cancels pending selector work and closes visible menus; their selection input never answers the request. Restore replaces transcript and model observations only after history succeeds, clears the previous retry input, and submits no model request. Subsequent input belongs to the selected Session. The persistence Provider owns discovery and the executor retains writer ownership.

The application declares the shared executor’s optional `modelSelection` service; a configured Provider applies durable selections to subsequent turns.

`/mode` lists standing compositions from the selected `agentPresets` Registry before the first turn. A numbered choice goes through the root executor's durable revision check and Agent replacement; the terminal receives only metadata and recorded selection facts. Started Sessions refuse changes, including after cold restore. The menu submits no model request. Custom profiles install the Registry and its standing compositions explicitly; the shipped template does not yet install them, and unavailable controls report that missing Provider.

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

- Shipped preset installation, permission selectors, Plan/Todo panels and contributed commands are not connected.
- Page Up and Page Down browse retained transcript rows using the shared rendered-line estimate. Sending input, restoring a Session or clearing the view returns to the bottom. Large individual messages and streamed output remain presentation-limited while complete accepted output stays in Session.
- The complete `native-tui` template depends on native entries owned by other modules; standalone terminal evidence uses explicit filesystem and external model Providers.

<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
