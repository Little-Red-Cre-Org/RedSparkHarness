# Agent Note: Native session titles and plan mode over shared cores

Status: implemented

English | [中文](2026-10-08-native-session-title-and-plan-mode.zh.md)

## Problem

The [compatibility inventory](2026-10-01-cordis-compatibility-inventory.md) listed `dsh-session-title`, its LLM providers and `dsh-plan-mode` as Cordis base-bundle features with no native entry, so native profiles had no session titles, no `/plan` command and no `exit_plan_mode` review. The title service and the plan controller held their behavior inside Cordis `Service` classes, so a native entry would have had to reimplement scheduling, supersession, fallback, selection and review rules.

## Decision

Migrate the framework, not the behavior. Each package keeps one framework-free core and two thin entries:

- **Session titles.** `src/engine.ts` (`SessionTitleEngine`) owns provider registration and teardown, per-session revisions and supersession, the first-prompt and all-prompts cadence, route-gated automatic generation, the deterministic fallback, rename, refresh and result acceptance. `src/facts.ts` owns the `session/title` event, the provider id, message extraction, validation, the log fold and config validation. The Cordis service adapts a `Session` with its projections, `session/event` and the marked `llm/stream` request; the native `./native` entry adapts an attached owner, folds its log, forwards `user/message`, `request/header` and `step/end`, persists through the owner and retains it while a provider runs.
- **Title generation.** `dsh-session-title-llm/src/core.ts` owns config validation, route resolution, framing, the `session/title-llm-request` record, dispatch, output validation and the message selectors. The Cordis helper streams through `ctx.llm`; `nativeSessionTitleLlmPlugin` streams through the native `model` service. Both provider packages use the shared selectors in both entries.
- **Plan mode.** `src/selection.ts` owns the selection state machine (`committed`, `queued`, `cancelled`, `noop`), step-boundary application, the narration rule, `/plan` parsing and the reviewed exit; `src/common.ts` owns the event, config, texts and the review question. The Cordis controller keeps its pre-step listener, prompt section and projection. The native entry applies pending selections at the next accepted step and delivers guidance as a queued plan-mode notice (the native system prompt is immutable). Step admission is only in memory, so a narrated selection commits when its notice's `user/message` is durable, not in the admission hook; a notice withdrawn after admission is re-queued when the turn settles. The mode at the last `step/start`, or the mode a durable notice announced, is what the model was told.

`native-tui` installs plan mode, session titles and the first-prompt provider with the Cordis base-bundle configuration; `native-web` installs titles and the first-prompt provider.

## Alternatives considered

**Native-only reimplementations:** They would duplicate the title concurrency rules and plan selection rules, and the two runtimes would drift.

**Admission hooks that add the plan notice:** Native step admission may only select captured inbox candidates, so the notice is queued in the durable inbox when the selection is made and withdrawn if the selection is reverted before admission.

## Consequences

Cordis behavior and tests are unchanged; both runtimes run the same title and plan decisions. Native differences are limited to delivery: plan guidance is a history notice rather than a prompt section, idle `/plan <message>` waits for the next prompt instead of waking a turn the TUI would not show, and a title provider call can extend a turn only when it outlasts the main request. Native web plan mode, title surfaces in `native-headless`, `native-sdk` and `native-acp`, and a native title command remain deferred.

In the compatibility inventory, `dsh-plan-mode`, `dsh-session-title-llm`, `dsh-session-title-first-prompt-llm` and `dsh-session-title-all-prompts-llm` move from `migration-required` to `native-mixed` (154 → 150 and 75 → 79), and `dsh-session-title` stays `native-mixed` with a new `./native` entry. Direct Cordis uses stay at 1,783 because the Cordis entries are kept as glue over the same cores.

## Verification

Mocked-model native specs cover `/plan` idle and mid-turn selection, notice withdrawal, a notice rejected after admission (the selection stays pending and commits only when a later step persists the notice), the approve, keep-planning, dismissal and inactive exit paths, the fallback title, provider titles with the logged route, the `session/title-llm-request` record, rename pinning and refresh. The existing Cordis specs of all five packages and their dependents pass unchanged, and the CLI profile spec checks the shipped rows.
