# Agent Note: Native profile Host reload

Status: implemented

English | [中文](2026-10-06-native-profile-host-reload.zh.md)

## Problem

The shipped `native-web` profile declares live configuration reload, but a running CLI must preserve Native Host ownership while its selected application configuration changes. Reloading the whole Host would discard unchanged installation identities, while treating an aborted old application run as process completion would prevent the new generation from serving.

## Decision

The CLI watches the active profile's `rsh.profile.json` and only the JSON files explicitly passed with `--patch`. It loads and resolves each candidate before changing the running Host. When scope ancestry, provider, and configuration are unchanged, the loader reuses the existing scope and installation request objects so `NativeHost.replace` retains those owners. The CLI serializes reloads and reconciles once after installing watchers so a change during startup is observed.

An invalid or unresolvable candidate is reported and discarded while the current graph remains active. A successful replace drains the interrupted application run; the CLI then invokes the application published by the active generation. Host activation or cleanup failure, and watcher failure, stop the process without reconstructing released owners. Shutdown closes watchers, stops the Host to interrupt the active run, and waits for queued reload and Host teardown.

Only the invocation signal's exact abort reason is treated as replacement cancellation. A rejection before the application callback because the Host is changing installations waits for the reload; an independent application rejection remains fatal with its original error, even during candidate preflight.

The `native-headless`, `native-sdk`, `native-acp`, and `native-tui` profiles remain startup-only. Host profile reload does not watch package source or rebuild Web Client assets, and it does not provide Cordis plugin HMR. Client asset reload is documented separately in [Native Web Connection and Client reload ownership](2026-10-05-native-web-connection-and-reload-ownership.md).

## Alternatives considered

**Recreate the Host for each edit:** Rejected because it would unnecessarily release unchanged providers and their owned state; `NativeHost.replace` already preserves owners when callers preserve request identity.

**Treat the previous application's abort as normal process exit:** Rejected because `NativeHost.replace` aborts the old invocation while handing the app to the new generation; the CLI must start the newly published application.

**Treat every rejection during reload as replacement cancellation:** Rejected because candidate preflight can overlap an independent application failure; only the invocation's abort reason or a pre-callback Host admission interruption is retried.

**Restore the old graph after replacement failure:** Rejected because activation or cleanup failure terminates the Host, and released owners cannot safely be made active again.

**Use Client asset reload or Cordis patch reload for native Host configuration:** Rejected because those mechanisms watch different files and update different runtime owners.

## Consequences

Malformed profile data cannot interrupt the active application. Successful changes retain unaffected native providers and replace the app generation only after the Host validates and activates the candidate. Package source changes still require a process restart, while the separate Web Client asset watcher continues to own browser bundle rebuilds.
