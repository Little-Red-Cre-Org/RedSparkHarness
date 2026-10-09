# Agent Note: Native Web shell modules share one Session authority

Status: implemented

English | [中文](2026-10-08-native-web-shell-and-title-ownership.zh.md)

## Problem

The explicit native-web profile could render a conversation but had no independently selectable navigation shell, appearance controls or Session details surface. Reusing the legacy shell directly would also import its Cordis registration path, while copying it into the application would duplicate existing Session and layout ownership.

## Decision

The native-web template selects six optional Client installers for locale, theme, Session presentation, layout, left sidebar and right details sidebar. They compose through the existing Native slot runtime and reuse `NativeConversationController`, the Native layout store and the existing theme and locale services. Each installer has its own capability requirements and cleanup; the sidebar obtains displayed title behavior through the Session presentation contract and imports no other feature package's runtime implementation.

Session titles remain durable `session/title` facts projected from Session history. Automatic provider work starts after the idle observer has captured current input and committed any fallback. The service retains the exact ActiveSession owner for that background task, then releases it when the provider finishes or fails. Rename and refresh delegate through the caller's existing RootExecution capability; they do not create another writer or title store. Provider and maintenance work is cancelled and drained during owner detach and service disposal, so prompt settlement does not wait for the auxiliary provider while safe teardown still waits for accepted work to finish.

The visible Workspace label is the selected Session header's `cwd`; this shell does not claim Workspace list, create, search, move or delete behavior. Selecting these modules remains explicit in the native-web profile. The compatibility application remains the default, and this change does not select the P5 default profile.

## Alternatives considered

**Copy the legacy shell into one Native application module.** Rejected because it would duplicate presentation and Session ownership, bind navigation to one large installer, and prevent other Native compositions from selecting only the needed shell capabilities.

**Reuse the Cordis-bound legacy sidebar and layout registrations.** Rejected because Native Client entries must remain usable without importing the legacy Cordis registration or service path.

**Await title generation in the Session idle callback.** Rejected because the active Program's settlement waits for admitted idle observers, so a slow optional provider would keep the user-facing turn pending. The retained owner task separates prompt completion while preserving cancellation and durable-write ownership.

## Consequences

The Native shell is assembled from optional feature modules over one slot renderer, one Session controller and one Session history. Slow providers may continue owning a Session until they settle after cancellation; teardown drains them rather than releasing an owner while its writer may still be active. Workspace CRUD, attachments and login remain outside this shell slice, and there is no legacy-default or Electron deployment claim.
