# Agent Note: Native Web shell modules share one Session authority

Status: implemented

English | [中文](2026-10-08-native-web-shell-and-title-ownership.zh.md)

## Problem

The Native sidebar and conversation view share one Session owner and one layout store. Session activity and Workspace membership come from Host-owned streams, so navigation must not infer Workspace identity from cwd or create another Session controller.

## Decision

The native-web template selects six optional Client installers for locale, theme, Session presentation, layout, left sidebar and right details sidebar. They compose through the existing Native slot runtime and reuse `NativeConversationController`, the Native layout store and the existing theme and locale services. Each installer has its own capability requirements and cleanup; the sidebar obtains displayed title behavior through the Session presentation contract and imports no other feature package's runtime implementation.

Session titles remain durable `session/title` facts projected from Session history. Automatic provider work starts after the idle observer has captured current input and committed any fallback. The service retains the exact ActiveSession owner for that background task, then releases it when the provider finishes or fails. Rename and refresh delegate through the caller's existing RootExecution capability; they do not create another writer or title store. Provider and maintenance work is cancelled and drained during owner detach and service disposal, so prompt settlement does not wait for the auxiliary provider while safe teardown still waits for accepted work to finish.

The Session controller follows Host list baselines and increments, which supply activity time, run state, completion, subagent count and pending-interaction state. Host and Client share Workspace and directory DTO declarations through the type-only `workspaces-types` entry, keeping Host handlers out of the Client RPC implementation. The sidebar groups rows by the registered workspaceId, follows the Workspace registry, and uses Host order for Workspaces and manual Session order. Recent-activity ordering, Session search and archive, Workspace selection/create/rename/delete, and directory picking call the selected Host clients; cwd supplies the registered path display only. Selecting these modules remains explicit in the native-web profile. The compatibility application remains the default, and this change does not select the P5 default profile.

## Alternatives considered

**Copy the legacy shell into one Native application module.** Rejected because it would duplicate presentation and Session ownership, bind navigation to one large installer, and prevent other Native compositions from selecting only the needed shell capabilities.

**Reuse the Cordis-bound legacy sidebar and layout registrations.** Rejected because Native Client entries must remain usable without importing the legacy Cordis registration or service path.

**Await title generation in the Session idle callback.** Rejected because the active Program's settlement waits for admitted idle observers, so a slow optional provider would keep the user-facing turn pending. The retained owner task separates prompt completion while preserving cancellation and durable-write ownership.

## Consequences

The Native shell is assembled from optional feature modules over one slot renderer, one Session controller and one Session history. Slow providers may continue owning a Session until they settle after cancellation; teardown drains them rather than releasing an owner while its writer may still be active. Workspace and Session drag-reordering gestures, additional Session search pages, the scheduled-task center, attachments and login remain outside this shell slice. There is no legacy-default or Electron deployment claim.
