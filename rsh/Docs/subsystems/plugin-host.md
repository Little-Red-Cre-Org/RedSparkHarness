---
description: "The ctx.pluginHost registry: RSH plugin descriptors and legacy Cordis adapter lifecycle."
kind: "subsystem"
---

# Plugin host subsystem

English | [中文](plugin-host.zh.md)

## Summary

`ctx.pluginHost` records an active RSH package descriptor while an adapter-owned Cordis Fiber runs. A descriptor names a package, RSH runtime API revision, role, and capability domain. The registry rejects duplicate package ownership and releases a descriptor with the adapter Fiber. It does not select plugin code, replace the Cordis Loader, wrap services or events, or sandbox a plugin.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `rsh/Scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpluginhost--rshpluginhost"></a>

### `ctx.pluginHost` — `RshPluginHost`

Owns declared RSH plugin identities and adapts legacy Cordis plugins without replacing Cordis services, events, Loader configuration, or fiber lifecycle.

```ts cordis-catalog
/**
 * Reserve a descriptor while its owner is mounted. Active duplicate names fail immediately.
 * @param descriptor - declared RSH ownership facts.
 * @returns an idempotent disposer that releases only this reservation.
 */
register(descriptor: RshPluginDescriptor): () => void

/**
 * Return the current descriptor for one package.
 * @param packageName - full npm package name.
 * @returns the descriptor, or undefined when no owner is active.
 */
get(packageName: string): RshPluginDescriptor | undefined

/**
 * List active descriptors in stable package-name order.
 * @returns every descriptor currently reserved by a mounted adapter.
 */
entries(): readonly RshPluginDescriptor[]
```

Source: [`rsh/Compatibility/DSH/bridge/compat-plugin-host/src/index.ts`](../../Compatibility/DSH/bridge/compat-plugin-host/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Model Experience

None. The registry neither changes model requests nor writes Session events.

## Related documentation

- [Plugin host package](../../Compatibility/DSH/bridge/compat-plugin-host/README.md) — package configuration and adapter use.
- [Capability seams](../capability-seams.md) — Definition, Provider, Consumer, policy, and projection roles.
- [Architecture](../architecture.md#cordis) — Cordis runtime and profile composition.
