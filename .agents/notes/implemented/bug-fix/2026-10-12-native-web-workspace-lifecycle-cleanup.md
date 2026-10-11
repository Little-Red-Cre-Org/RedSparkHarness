# Agent Note: Native Web Workspace lifecycle cleanup

Status: implemented

English | [中文](2026-10-12-native-web-workspace-lifecycle-cleanup.zh.md)

## Problem

Native Web workspace registrations, dynamic Program routes, queued mutations, and Client follow iterators have separate lifetimes. Deleting a registration could leave idle Session owners and consume route capacity; cancelled queued work could still mutate state; and closing a Client could wait forever while its consumer was paused after a yielded frame. Cold persisted workspace Sessions also appeared unable to manage titles before route selection, while one unusable directory link could fail the complete listing.

## Decision

Queued Workspace operations check caller cancellation before joining the queue and again when they start. Delete retires each active root owner captured on the Workspace route, releases that route, then removes the registration. A busy route prevents deletion from removing the registration. Directories and durable Session logs remain.

Workspace follows use the configured `maxFollowers` capacity and return HTTP 429 when full. Client follow completion resolves on abort even when its async generator is parked at `yield`; its abort listener is removed when the generator completes.

Title management remains available for a persisted Workspace Session with no selected dynamic route when titles are installed and no delegated owner conflicts. The rename and refresh handlers select the route through `routeForSession()`. Directory listing omits symlinks whose target `stat()` fails and keeps usable sibling entries.

## Alternatives considered

- **Remove the Workspace registration before releasing its route.** Rejected because a busy route could then remain allocated without its registered Workspace; deletion keeps the registration when route retirement fails.
- **Wait for the async generator's `finally` during Client close.** Rejected because a consumer parked at a yielded frame cannot enter `finally` until it resumes or returns the iterator.
- **Fail the full directory listing when one link cannot be stated.** Rejected because an unusable entry should not hide valid siblings.
- **Keep title actions disabled until a Workspace route already exists.** Rejected because the handlers can select the registered Workspace route themselves.

## Consequences

Workspace deletion now reclaims idle runtime ownership as part of the queued operation; active work still blocks route withdrawal and leaves the registration available for a later retry. Workspace and Session follow streams each enforce the configured follower limit. Cold title actions can be offered before route selection, and unusable symlinks disappear from listings without suppressing other entries.
