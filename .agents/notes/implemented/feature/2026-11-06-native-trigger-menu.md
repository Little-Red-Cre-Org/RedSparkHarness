# Agent Note: The Native trigger menu reads the composer instead of being read by it

Status: implemented

English | [中文](2026-11-06-native-trigger-menu.zh.md)

## Problem

Installing `ui-reference`'s Native source made the `@` pipeline complete and still invisible: nothing in a Native client turned a keystroke into `track()`, and nothing rendered the menu the pipeline built. `native-application`'s composer owned its own `/` palette and called no `clientNativeInputTrigger` method at all.

The obvious wiring does not plan. The pipeline requires `clientNativeConversation` — it scopes one controller per Session — so a conversation that required the pipeline back would close a cycle. That is not a style objection: `resolveInstallation` orders installations by dependency and refuses a cycle outright. A probe with the exact shape (application optionally requiring the trigger, the trigger requiring the conversation, both in one scope) fails with `native-runtime: dependency cycle at app`.

## Decision

The edge runs the other way. The conversation publishes `clientNativeComposer`, and the pipeline requires it:

```ts ignore-check
export interface NativeComposerService {
  getSnapshot(): { readonly text: string; readonly caret: number }
  subscribe(listener: () => void): () => void
  replaceToken(span: { readonly start: number; readonly end: number }, text: string): void
}
```

Three members and no more. The composer owns the draft, the caret and the span arithmetic; the pipeline owns detection, candidate fetching, the menu store and pick routing. Neither reaches into the other's state: the composer publishes what the pipeline reads and accepts one replacement, and the pipeline never asks the composer to render.

The application binds the live surface from the mounted conversation and publishes the service regardless, so the pipeline can subscribe before the surface exists. Its getter answers an empty draft in that window rather than throwing at a caller that only runs while the composer is on screen.

The pipeline subscribes once, compares the published draft and caret against the last tracked pair, and calls `track()` only when they changed. It also renders the menu itself: `native-menu.tsx` reads the Session's menu store and is registered into `native.conversation.overlay`, a list slot the conversation declares and seats above the composer.

That slot is `root`-scoped with the Session id as owner props, not `session`-scoped. A `session` slot requires a scope binding at render, and the composer renders in the root scope; passing the id as owner data is what lets one root surface render the selected Session's menu.

## Alternatives considered

**Let the application require `clientNativeInputTrigger` and render the menu itself.** Rejected twice over: the planner refuses the cycle, and the composer would then own the menu's contents, which is the pipeline's job in the browser build too.

**Make the pipeline's conversation dependency optional.** Rejected: the pipeline genuinely cannot scope a controller without the Session list, and an optional edge would only move the failure to the first keystroke.

**Have the pipeline read the textarea through the DOM.** Rejected: the composer's draft is React state, and reading a DOM node across installations would make the pipeline depend on where the composer happens to mount.

**Render the menu through the existing `/` palette.** Rejected: that palette is a separate surface with its own catalog and its own store; making it render trigger rows would give one region two owners of what is visible.

## Consequences

- A Native user pressing `@` now sees file and session candidates, and picking one replaces the token in the draft with the same mention the browser inserts.
- The composer and the pipeline can be installed independently: a composition without the pipeline has a composer that publishes a draft nobody reads, and a composition without the composer has a pipeline whose source roster no keystroke reaches. Neither fails to load.
- The menu renders one flat list per group. The browser menu also renders section headings and a breadcrumb header; this surface drops both, so a drilled directory listing shows its rows without the trail back.
- Coverage: `tests/native-menu.client.spec.tsx` pins the empty-group drop, the closed and empty renders, the highlight, the focus-preserving press and the hover route. Reverting the empty-group filter and the `preventDefault` each turned their own cases red.
