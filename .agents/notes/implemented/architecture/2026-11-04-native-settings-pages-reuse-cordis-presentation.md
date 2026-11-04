# Agent Note: Native settings pages reuse the browser presentation

Status: implemented

English | [中文](2026-11-04-native-settings-pages-reuse-cordis-presentation.zh.md)

## Problem

Two Web settings packages — the read-only plugin inventory tab and the Models page — carry their whole presentation as props-driven components plus a page store, but each reached the Host through a Cordis-only surface. The inventory tab read `ctx.remote.pluginInventory`, which answers a Loader composition: per-preset rows and global Loader entries with root-fiber phases. The Models page read `ctx.remote.llm`, `ctx.remote.credentials` and `ctx.remote.settings` and took ui-settings' `SettingsSchemaService` and shared describe mirror.

A Native host has none of those. It has no Loader, so it reports installations rather than Loader entries, and no Settings slots, so the pages have no shell to register into. Rewriting either page as a second Native implementation would double the provider-editor, catalog and onboarding surfaces that the two clients must keep identical.

## Decision

Each package gains a Native entry that binds the SAME presentation to the Native transport.

**The inventory tab adapts rather than re-implements.** `clientNativeSession.pluginInventoryList` reports installation states; `installationPhase` maps the closed state union onto the catalog's root-fiber phase vocabulary, and `toSnapshot` projects rows into the global plane. A Native profile installs the rows its composition names, so every reported installation is enabled and only `disposed` is not. No Agent-preset roster exists on this transport, so `agentPresets` stays absent and the catalog renders the global plane alone.

**The Models page narrows its dependency to a port.** `ModelsSettingsStore`, `createModelsOperations` and every provider card took a Cordis `Context`; they now take `ModelsRemoteHost`, the Remote slice they actually read, with the wire types owned by the package's own `client/ports.ts`. `createNativeModelsFace` answers the same carrier envelopes from `clientNativeSession`, and `createNativeDescribeFace` is the page's document read. The two Native/browser differences are folded in the adapter: the Native transport rejects instead of answering a failure envelope, and it spells namespace identity `namespace` where the wire spells it `ns`.

**The schema port is a declared prerequisite.** The Models page needs schema reads and immutable draft edits, which ui-settings publishes as `clientNativeSettings.schema` from its own Native entry. This package declares that service name and lists it under `optional` rather than importing the service class, so the package builds and is reviewed on its own. Declaration merging compares whole declarations, so the augmentation is a named reference type (`NativeSettingsServiceReference`) held to the provider's shape: both sides must name the same type, and widening or narrowing one breaks the merge. A composition without the settings domain base fails loud at activation naming the missing provider.

## Alternatives considered

**A second Native implementation of each page.** This duplicates the provider editor, model list editor, onboarding dialogs and inventory catalog, and the two copies drift on the first copy change. The browser half of both packages is already props-driven; only the transport was Cordis-shaped.

**Import ui-settings' Native entry to reuse its service class.** This makes one package's build depend on another package's entry, which the native dependency graph rejects, and it would pin the two packages' release order for no gain over a declared port.

**Register into `settings.plugins.tab` unconditionally.** A bare `slots.register` into an undeclared slot throws. Both entries go through `slots.inject`, which waits for the declaration, removes the contribution when it collapses, and installs nothing while no Native settings shell declares the seat.

## Consequences

Both packages publish `./native` and are installed by the shipped native Web profile. The inventory tab contributes as soon as a Native settings shell declares `settings.plugins.tab`. The Models page publishes a transport-bound store, operations and schema port from its Native entry; it renders once a Native settings shell declares `settings.section`, and that shell's own Native half is the remaining prerequisite — the Native application's Settings panel builds its pages in place today instead of through the settings slots.

The `dsh.native` manifests stay accurate for what each entry installs: the inventory tab requires `clientSlots`, `clientLocale` and `clientNativeSession`; the Models page requires the locale registry and the Session client and treats the settings domain base as optional.