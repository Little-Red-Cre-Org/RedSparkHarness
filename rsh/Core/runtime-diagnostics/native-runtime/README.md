---
description: "Portable native plugin planning, scoped services and owned asynchronous cleanup."
kind: "package-library"
---

# @deepseek-ai/dsh-native-runtime

English | [中文](README.zh.md)

## Summary

This library resolves explicit plugin selections and activates them without Cordis or Node imports. It depends only on the portable `dsh-brand` type helper. Native execution API revision 1 is independent of `dsh.runtime` role metadata and Session versions.

## Table of Contents

- [Installation and cleanup](#installation-and-cleanup)
- [Entry metadata](#entry-metadata)
- [Events](#events)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="installation-and-cleanup"></a>
## Installation and cleanup

`NativeContributions<T>` stores named values within one Provider scope tree. Lookup includes ancestors, chooses the nearest registration for each name, and excludes siblings; registration and lookup outside that tree fail. Duplicate names fail within a layer. Registration returns an idempotent disposer bound to that registration, including when a later owner registers the same value. Consumers own resource cleanup and copy mutable values before exposing them to callers.

`resolveInstallation(requests, target)` checks versions, targets, provider conflicts, missing dependencies and cycles before resolving configuration. A plugin's `resolve(config)` validates configuration without acquiring resources and returns its activation function. A consumer reads only declared services, selecting the nearest provider in its scope or ancestry; separate roots isolate realms. Providers become visible only after activation succeeds and all declared services exist.

Service Definition packages extend `NativeServices`, and event Definition packages extend `NativeEvents`, from the `@deepseek-ai/dsh-native-runtime` package root. The Host and event bus use those same merged declarations.

`NativeHost` owns each activation before calling it. Plugins register resource cleanup immediately through `context.own()`, registrations through `context.effect()`, and subscriptions through `context.on()`. An effect's disposer must synchronously close admission and return completion after its admitted callbacks settle. Owner cancellation starts every effect drain before releasing any resource, including resources acquired after registration. Stop aborts owned signals, closes event admission, awaits callbacks and startup settlement, and disposes consumers before providers. Resource cleanup runs in reverse acquisition order, attempts every disposer and reports aggregate failures. Plugins must cooperate with cancellation and await their own in-flight work during disposal. Cleanup does not undo completed external writes.

`context.optional()` reads only explicitly optional capabilities and returns undefined when no provider was selected. `host.remove(request)` accepts the original installation request object and stops that installation and its transitive consumers. Unrelated owners remain active; affected subscriptions close admission and drain their callbacks before resource disposal. Removal is idempotent and does not automatically select another provider.

`host.diagnostics()` reports each installation lifetime's opaque identity, opaque scope identity, selected service providers, lifecycle state, failure phase and cleanup outcome, including disposed predecessors. It excludes configuration values, scope objects and error messages. `host.run(scope, initiator, work)` captures the initiating execution explicitly per call; parallel calls retain separate actors and stop waits for admitted work to settle before releasing providers. `host.runOwned(request, initiator, work)` additionally binds cancellation to a ready installation; removing or replacing its owner cancels and drains that operation. `host.signal` reports whole-Host cancellation; installation replacement alone does not abort it.

`host.replace(plan)` accepts a complete resolved plan for the same Host/Client target. Reusing a request preserves its ready owner only when its selected dependencies also remain unchanged. Changed dependencies reactivate transitive consumers, including optional and nearer-scope Providers. Queued mutations reject new Host invocation admission; affected calls and subscriptions drain before reverse dependency cleanup, and cleanup completes before successor activation. Unbound `run()` calls are conservatively cancelled during any effective mutation; unaffected `runOwned()` calls retain their lifetime. Resolution failures leave the old composition active. Cleanup or activation failure stops the Host and releases every remaining owner without restoring disposed services.

<a id="entry-metadata"></a>
## Entry metadata

`parseNativeEntryManifest(value, exports)` validates `package.json.dsh.native` before importing the entry. Revision 1 declares an exported package subpath, Host/Client targets and required, optional and provided service names. `validateNativePluginEntry(plugin, manifest)` then checks the named `plugin` export against that declaration before planning. The [CLI native loader](../../../Programs/CLI/README.md#profiles) uses both checks; this library does not read package files or launch an application. An application Provider exposes `NativeApplication.run(args, signal)`; the CLI invokes it through `host.runOwned()` and waits for host disposal.

<a id="events"></a>
## Events

Event Definition packages extend `NativeEvents` with mode, arguments and result from the package root. Synchronous dispatch propagates exceptions; serial delivery stops on rejection; parallel delivery settles every listener before reporting failures. Waterfall requires explicit `next()` delegation, supports short-circuiting and rejects repeated delegation. Ancestor subscriptions receive descendant dispatches in registration order; other realms do not. Error isolation belongs to the event owner.

<a id="model-experience"></a>
## Model Experience

None, as this library does not construct model requests or durable Session events.

#### KV Cache effect

No request content is added or reordered.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Automatic profile file watching and module-code reload are not provided by this library. Generic diagnostics contain lifecycle phases but no application failure details. Callers await `stop()`, `remove()` and `replace()` from outside the work or callback being drained; awaiting one's own completion would deadlock. Engine passes the actual Agent/tool initiator and owns its Session flush order. Same-process plugins are trusted; scope visibility does not sandbox Node access.

No invariant companion is published: installation readiness and resource release have one owner, with no independent durable observations to reconcile.

<a id="dev-note"></a>
### Dev Note

None.
