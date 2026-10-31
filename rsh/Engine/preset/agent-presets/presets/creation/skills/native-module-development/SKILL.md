---
name: native-module-development
description: Create or change a Native module — a package the Host resolves through dsh.native. Use this when adding a plugin, a tool row, or a service provider. Do not use Cordis dynamic plugins.
---

# Develop Native modules

A Native module is an installed package, not a string of JavaScript mounted at runtime. There is no `cordis_define`, `cordis_run`, or `cordis_inspect`.

## Package

`package.json` sets `"type": "module"` and:

```json
"dsh": { "native": { "apiVersion": 1, "entry": "./native", "targets": ["host"], "requires": [], "optional": [], "provides": [] } }
```

`src/native.ts` exports `plugin` with the same `name`, `targets`, `requires`, and `provides`. `resolve(input)` validates config and returns `(context) => { ... }`. `context.require` reads a service listed in `requires`. `context.provide` publishes a service listed in `provides`. `context.effect` registers work the Host disposes. The manifest `requires` list must equal the plugin `requires` list, or the Host refuses to start.

Build the package so `./native` resolves to the built entry. Install it where the profile resolves packages. Then add an installation row to `rsh.profile.json` for a shared service, or to a preset's `agent.native.json` for a session-scoped row.

## Placement

A service read by more than one preset belongs in the profile. A persona, presentation, or other session-only row belongs in the preset. Do not publish the same service from two presets.

Restart the Host after the installation row changes. A row whose package cannot be resolved, or whose required service is absent, does not load.
