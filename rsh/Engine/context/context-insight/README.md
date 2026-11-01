---
description: "Records what a Session's context is made of and how it grew, as three durable Session projections plus the /context command."
kind: "package-reference"
---

# @deepseek-ai/dsh-context-insight

English | [中文](README.zh.md)

## Summary

Records what a Session's context is made of and how it grew, as three host-only Session projections that replay from the durable log without the Agent being alive. Ported from the Cordis `dsh-context` plugin: that plugin shipped one prebuilt browser half (617 KB) bound to six Cordis client services, none of which exist on a Native deployment, so what survives here is the durable analysis rather than the bundle.

## Table of Contents

- [Summary](#summary)
- [Configuration](#configuration)
- [Composition](#composition)
- [Layout](#layout)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Configuration

This package configures nothing; it reads only fixed state and ships no Schemastery schema. The rows it registers are fixed:

| Projection key | State |
| --- | --- |
| `contextComposition` | Characters per category, turn/step/request counts, every system prompt the Session sent, and the route its requests used. |
| `contextRequests` | One row per `request/header`: tool count, reason, and whether it began a distinct message series. |
| `contextActivity` | Per local calendar day: characters, requests, turns, steps, tool calls. |

Categories stay apart on purpose. A plugin injection and a skill load are user-role messages too; folding them into `user` would hide how much of the context is the harness talking to itself, which is the question this exists to answer.

Tool schema size is counted where a request sends it (`request/header`), not inferred from the calls that happened to use a tool.

Days are local, because the reader is a person in their own day boundaries; UTC would file an evening's work under tomorrow.

## Composition

| Service | Use |
| --- | --- |
| `sessionProjections` | Registers the three folds. Required. |
| `commands` | Registers `/context`. Optional; a deployment without a command service still gets the projections. |

No runtime invariant companion is published because every fold is a pure, total function over the durable log: there is no second observation to disagree with, so the state is its own contract and `stateSchema` validates it on read.

## Layout

| File | Role |
| --- | --- |
| [`src/composition.ts`](src/composition.ts) | The composition fold and its durable schema. |
| [`src/requests.ts`](src/requests.ts) | The request-history fold. |
| [`src/activity.ts`](src/activity.ts) | The per-day activity fold. |
| [`src/report.ts`](src/report.ts) | Plain-text `/context` rendering. |
| [`src/index.ts`](src/index.ts) | Projection registration and the optional command. |

## Model Experience

### The `/context` command

#### What the model sees

Nothing. The command runs after a turn, answers the person who typed it, and writes no message into the Session, so no model request changes because it ran. The three projections are equally invisible: they add no prompt section, no tool schema and no injection.

##### `/context` output

```markdown
Context

  Route      deepseek / deepseek-flash
  Turns      3    Steps 7    Requests 7

Composition — 18,204 chars ≈ 4,551 tokens

  System prompt     █████████████·····  9,412     52%
  Tool schemas      ██████············  4,106     23%
  Your messages     ███···············  2,088     11%
  Tool results      ██················  1,596      9%
  Assistant output  █·················    902      5%
```

#### Token effect

None on any request. The report is printed text outside the durable transcript, and the estimate it shows is arithmetic on stored character counts rather than a measurement of the next request.

#### KV Cache effect

None. No request prefix changes because the command ran, so no cache is invalidated and the next turn reuses whatever prefix it would have used anyway.

## Known Limitations and Deferred Work

- **The desktop cannot read these states yet.** The projections reach the profiles that compose `session-projections`, which today is `native-headless-query` only. `native-web` and `native-tui` compose no projection registry, so bringing this to the desktop needs a projection channel on the Web Host — a separate change with Host and client sides.
- **No dashboard.** The Cordis plugin also rendered a cross-session Insights page, a Context tab, a Fleet view and a right-sidebar panel. Those are not ported; only the durable analysis and the command are.
- **Character counts, not provider tokens.** No tokenizer is available here, so the estimate is arithmetic on characters rather than the provider's own count. A `request/context` event carries a `contextWindow` when the route advertises one, and the report shows it without claiming the estimate matches it.
- **Cost is not computed.** The original read a priced catalog; this package has none, so no monetary figure is reported.

<a id="dev-note"></a>

### Dev Note

None.
