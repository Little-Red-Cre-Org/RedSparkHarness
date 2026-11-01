# @deepseek-ai/dsh-context-insight

Durable context insight for a Native deployment: three Session projections and
the `/context` command.

Ported from the Cordis `dsh-context` plugin. That plugin shipped one prebuilt
browser half (617 KB) bound to six Cordis client services — `api-remotes`,
`client-connection`, `client-locale`, `ui-conversation`, `ui-settings` and
`ui-sidebar-right`. None of them exist on a Native deployment, so that bundle
cannot load here. What carried the value was the durable analysis, and it
survives as plain folds over the Session log.

## What it folds

Each projection is a pure function of the log, so a stored Session replays
without the Agent being alive.

| Key | State |
| --- | --- |
| `contextComposition` | Characters per category, turn/step/request counts, every system prompt the Session sent, and the route its requests used. |
| `contextRequests` | One row per `request/header`: tool count, reason, and whether it began a distinct message series. |
| `contextActivity` | Per local calendar day: characters, requests, turns, steps, tool calls. |

Categories stay apart on purpose. A plugin injection and a skill load are
user-role messages too; folding them into `user` would hide how much of the
context is the harness talking to itself, which is the question this exists to
answer.

Tool schema size is counted where a request sends it (`request/header`), not
inferred from the calls that happened to use a tool.

Days are local, because the reader is a person in their own day boundaries; UTC
would file an evening's work under tomorrow.

## The command

`/context` renders the composition, the character and token totals, and the most
recent requests as plain text. Plain text renders the same in a terminal, in the
Web transcript and in a log excerpt, and needs no client component.

The command is optional: a deployment that composes no command service still
gets the three projections.

## Scope

The projections reach the profiles that compose `session-projections`, which
today is `native-headless-query`. `native-web` and `native-tui` compose no
projection registry, so the desktop application cannot read these states yet;
bringing them to the desktop needs a projection channel on the Web Host.

## Composition

| Service | Use |
| --- | --- |
| `sessionProjections` | Registers the three folds. Required. |
| `commands` | Registers `/context`. Optional. |

## Layout

| File | Role |
| --- | --- |
| [`src/composition.ts`](src/composition.ts) | The composition fold and its durable schema. |
| [`src/requests.ts`](src/requests.ts) | The request-history fold. |
| [`src/activity.ts`](src/activity.ts) | The per-day activity fold. |
| [`src/report.ts`](src/report.ts) | Plain-text `/context` rendering. |
| [`src/index.ts`](src/index.ts) | Projection registration and the optional command. |

No runtime invariant companion is published because every fold is a pure,
total function over the durable log: there is no second observation to disagree
with, so the state is its own contract and `stateSchema` validates it on read.
