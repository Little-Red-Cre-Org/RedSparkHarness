# Agent Note: Native rows host Cordis plugins through a mixed bridge

Status: implemented

English | [中文](2026-10-20-native-cordis-hosting-rows.zh.md)

## Problem

A Native preset must run a shipped Cordis plugin without shipping the legacy assembly. The plugin needs a live Cordis context and the services it reads, and both live outside the Native runtime package set. The native source gate rejects a Native entry whose source references `@deepseek-ai/cordis`, and the runtime-layer policy rejects a Core package that depends on an Engine package. A bridge that lives in Core and translates the persona services therefore violates two independent gates.

## Decision

`@deepseek-ai/dsh-cordis-bridge` is a mixed Native entry package. It owns the Cordis context and the Native plugin wrapper, and it declares `@deepseek-ai/cordis` as an optional peer plus a dev dependency rather than a direct dependency. Its native source is admitted by `cordisHostingNativeReferences`, the only source reference a Native entry may make to Cordis.

`@deepseek-ai/dsh-native-persona` is a mixed Native entry package in `rsh/Engine/preset`. It owns the persona translation: `personaServices` presents the Native prompt registry as the Cordis `systemPrompt` service and registers the persona sections on the installation scope. The translation lives in the Engine layer because it reads `@deepseek-ai/dsh-system-prompt`, which a Core package may not depend on.

The bridge publishes only the host. A caller translates the services its own Cordis plugin reads and hands the translated set to `hostCordisPlugin`.

## Alternatives considered

**Keep the persona translation in the bridge package:** the bridge would depend on `@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/dsh-native-prompt`, both Engine packages, and the runtime-layer policy rejects a Core package that consumes an Engine package.

**Declare Cordis as a direct dependency:** a Native entry that imports the Cordis runtime fails the native dependency gate, and the Cordis peer policy requires the peer and dev form.

**Expose the bridge as a Cordis-free native-safe subpath:** the native source graph follows the reachable source of the entry, so a subpath that reaches Cordis is still rejected. Only an explicit per-package admission resolves it.

## Consequences

A Native preset can host a shipped Cordis plugin. The bridge owns the Cordis context lifecycle and the plugin's teardown; the translation owner owns the service surface. `cordisHostingNativeReferences` admits Cordis only for the packages that host a Cordis plugin, so the gate still rejects Cordis references in every other Native entry. This extends the [Native closure skips compatibility-only peers](2026-10-20-native-closure-skips-compatibility-peers.md) decision.
