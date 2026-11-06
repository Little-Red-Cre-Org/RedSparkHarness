# Agent Note: The Native trigger menu follows the composer and the selection

Status: implemented

English | [中文](2026-11-06-native-trigger-menu.zh.md)

## Problem

Installing `ui-reference`'s Native source made the `@` pipeline complete and still invisible: nothing in a Native client turned a keystroke into `track()`, and nothing rendered the menu the pipeline built. `native-application`'s composer owned its own `/` palette and called no `clientNativeInputTrigger` method at all.

The obvious wiring does not plan. The pipeline requires `clientNativeConversation` — it scopes one controller per Session — so a conversation that required the pipeline back would close a cycle. That is not a style objection: `resolveInstallation` orders installations by dependency and refuses a cycle outright. A probe with the exact shape (application optionally requiring the trigger, the trigger requiring the conversation, both in one scope) fails with `native-runtime: dependency cycle at app`.

Two facts about the surfaces decide the rest. A slot injection is computed once per registered entry and never recomputed, so anything the root-scoped menu seat injects has to be live by construction. And the browser's `MenuView` takes a plain data interface, `MenuViewInjected`, with no Cordis contact.

## Decision

The edge runs the other way. The conversation publishes `clientNativeComposer`, and the pipeline requires it:

```ts ignore-check
export interface NativeComposerService {
  getSnapshot(): { readonly text: string; readonly caret: number; readonly revision: number }
  subscribe(listener: () => void): () => void
  replaceToken(span: { readonly start: number; readonly end: number }, text: string): void
}
```

The composer owns the draft, the caret, the revision and the span arithmetic; the pipeline owns detection, candidate fetching, the menu store and pick routing. Neither reaches into the other's state. One ref owns the draft: `replaceToken` writes that ref before it notifies, so what a subscriber reads afterwards cannot lag the text it was told about.

The pipeline syncs the published draft and caret on both sources of change — a keystroke republishes the draft, and a Session switch changes which draft matters — and runs the sync once on install so a Session selected before this entry mounted is not skipped. Leaving a Session dismisses the menu it left open, because those rows belong to a composer the user can no longer see. The revision the composer publishes is what a hit is stamped with, matching the `draftRev` the browser's detection records.

The menu is the browser's `MenuView`, registered into `native.conversation.overlay`, a list slot the conversation declares and seats above the composer. That seat is root-scoped, so its `inject` receives no Session id and runs once: every member resolves the Session at call time, and the two stores `MenuView` subscribes to are wrappers that re-point at the selected Session's own store while keeping the subscribers already made. Handing `MenuView` a captured snapshot would freeze it on whichever Session was selected when it first mounted.

## Alternatives considered

**Let the application require `clientNativeInputTrigger` and render the menu itself.** Rejected twice over: the planner refuses the cycle, and the composer would then own the menu's contents, which is the pipeline's job in the browser build too.

**Make the pipeline's conversation dependency optional.** Rejected: the pipeline genuinely cannot scope a controller without the Session list, and an optional edge would only move the failure to the first keystroke.

**Have the pipeline read the textarea through the DOM.** Rejected: the composer's draft is React state, and reading a DOM node across installations would make the pipeline depend on where the composer happens to mount.

**Write a Native-only menu and share the row projection.** Rejected: `MenuViewInjected` carries no Cordis contact, so a second surface would have duplicated a complete component — its stylesheet, breadcrumbs, group titles, drill hint and skeleton rows — to read the same store.

**Seat the menu in a session-scoped slot.** Rejected: a session-scoped slot needs a scope binding at render, and the composer renders in the root scope. The root seat costs the live re-point above; passing the Session id as owner data alone would not help, because the injection is cached before any owner prop exists.

## Consequences

- A Native user pressing `@` sees file and session candidates, and picking one replaces the token in the draft with the same mention the browser inserts.
- The two halves cannot drift on what a menu shows: both render `MenuView` from the same store.
- The composer and the pipeline can be installed independently: a composition without the pipeline has a composer that publishes a draft nobody reads, and a composition without the composer has a pipeline whose source roster no keystroke reaches. Neither fails to load. The application's `dsh.native.provides` must list `clientNativeComposer`, because the Desktop preflight builds its service graph from the manifest while the Web client reads only the entry.
- Coverage: `tests/native-composer.client.spec.ts` pins the tracked draft, caret and revision, the republish dedupe, the selection switch, the dismiss of the left Session's menu, the unsubscribe on unload, and that no Session is consulted while none is selected.
