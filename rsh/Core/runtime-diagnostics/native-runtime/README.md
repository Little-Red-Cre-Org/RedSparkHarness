---
description: "Portable native plugin planning, scoped services and owned asynchronous cleanup."
kind: "package-library"
---

# @deepseek-ai/dsh-native-runtime

English | [中文](README.zh.md)

## Summary

This library resolves explicit plugin selections and activates them without Cordis or Node imports. It depends only on the portable `dsh-brand` type helper. Production profiles retain their existing composition. Native execution API revision 1 is independent of `dsh.runtime` role metadata and Session versions.

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

`resolveInstallation(requests, target)` checks versions, targets, provider conflicts, missing dependencies and cycles before resolving configuration. A plugin's `resolve(config)` validates configuration without acquiring resources and returns its activation function. A consumer reads only declared services, selecting the nearest provider in its scope or ancestry; separate roots isolate realms. Providers become visible only after activation succeeds and all declared services exist.

`NativeHost` owns each activation before calling it. Plugins register resource cleanup immediately through `context.own()` and subscribe through `context.on()`. Stop aborts owned signals, closes event admission, awaits callbacks and startup settlement, and disposes consumers before providers. Resource cleanup runs in reverse acquisition order, attempts every disposer and reports aggregate failures. Plugins must cooperate with cancellation and await their own in-flight work during disposal. Cleanup does not undo completed external writes.

`context.optional()` reads only explicitly optional capabilities and returns undefined when no provider was selected. `host.remove(request)` accepts the original installation request object and stops that installation and its transitive consumers. Unrelated owners remain active; affected subscriptions close admission and drain their callbacks before resource disposal. Removal is idempotent and does not automatically select another provider.

`host.diagnostics()` reports each planned installation's opaque identity, opaque scope identity, selected service providers, lifecycle state, failure phase and cleanup outcome. It excludes configuration values, scope objects and error messages. `host.run(scope, initiator, work)` captures the initiating execution explicitly per call; parallel calls retain separate actors and stop waits for admitted work to settle before releasing providers.

<a id="entry-metadata"></a>
## Entry metadata

`parseNativeEntryManifest(value, exports)` validates `package.json.dsh.native` before importing the entry. Revision 1 declares an exported package subpath, Host/Client targets and required, optional and provided service names. `validateNativePluginEntry(plugin, manifest)` then checks the named `plugin` export against that declaration before planning. The [CLI native loader](../../../Programs/CLI/README.md#profiles) uses both checks; this library does not read package files or launch an application. An application Provider exposes `NativeApplication.run(args, signal)`; the CLI invokes it through `host.run()` and waits for host disposal.

<a id="events"></a>
## Events

Definitions extend `NativeEvents` with mode, arguments and result. Synchronous dispatch propagates exceptions; serial delivery stops on rejection; parallel delivery settles every listener before reporting failures. Waterfall requires explicit `next()` delegation, supports short-circuiting and rejects repeated delegation. Ancestor subscriptions receive descendant dispatches in registration order; other realms do not. Error isolation belongs to the event owner.

<a id="model-experience"></a>
## Model Experience

None, as this library does not construct model requests or durable Session events.

#### KV Cache effect

No request content is added or reordered.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Profile integration, external package discovery and hot replacement remain unimplemented. Generic diagnostics contain lifecycle phases but no application failure details. Callers await `stop()` and `remove()` from outside the work or callback being drained; awaiting one's own completion would deadlock. Engine must pass the actual Agent/tool initiator and own its Session flush order before production migration. Same-process plugins are trusted; scope visibility does not sandbox Node access.

No invariant companion is published: installation readiness and resource release have one owner, with no independent durable observations to reconcile.

<a id="dev-note"></a>
### Dev Note

None.
