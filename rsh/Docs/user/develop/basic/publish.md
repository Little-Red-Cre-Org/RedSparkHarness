# Package and install a Native plugin

English | [中文](publish.zh.md)

The previous tutorials mounted a local plugin through a profile composition. This tutorial packages that plugin as an npm package with a Native entry, installs it into a profile, and explains how the profile JSON names it. It assumes the `dsh` CLI is installed. Complete [plugin configuration](./config.md) first.

To use a fresh source checkout instead, keep this tutorial's `hello-plugin` directory at the repository root and run the remaining commands from there as `pnpm ...`. See [source execution](../../../../Programs/CLI/reference/README.md#source-execution) for build and launcher behavior.

## The package manifest

A Native plugin is an ordinary ESM package that publishes a named `plugin` export and declares its protocol metadata under `dsh.native`:

```
hello-plugin/
├── package.json
└── index.js
```

Create `hello-plugin/package.json`:

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": {
    "native": {
      "apiVersion": 1,
      "entry": ".",
      "targets": ["host"],
      "requires": [],
      "optional": [],
      "provides": []
    }
  }
}
```

`entry` must name a published `exports` subpath. `targets` selects `host`, `client`, or both. `requires` lists the services that must already have a Provider, `optional` lists services the plugin uses when present, and `provides` lists the service keys it registers. The launcher validates this metadata before importing the entry.

## The plugin entry

Create `hello-plugin/index.js`:

```js
export const plugin = {
  apiVersion: 1,
  name: 'hello-plugin',
  targets: ['host'],
  requires: [],
  provides: [],
  resolve(config) {
    return (ctx) => {
      console.log('[hello-plugin] plugin loaded!', config)
    }
  },
}
```

`resolve(config)` validates the installation's configuration and returns the activation function; it must not activate resources itself. The runtime calls the activation with the installation's scope context, whose `signal` aborts on shutdown and whose `own(disposer)` registers teardown. Every exported field must agree with `dsh.native`; a mismatch fails before activation.

A plugin that registers a service declares the same key in `provides` and calls `ctx.provide(key, value)` from its activation.

## Install into a profile

A profile is a directory under `$RSH_HOME/profiles/<name>` with a `package.json` runtime marker and an `rsh.profile.json` composition. Install the package into that directory with pnpm:

```sh
cd "$RSH_HOME/profiles/demo"
pnpm add /path/to/hello-plugin
```

Then add one installation row to `rsh.profile.json`:

```json
{
  "formatVersion": 1,
  "scopes": [{ "id": "root" }],
  "installations": [
    { "id": "hello", "plugin": "dsh-hello-plugin", "scope": "root" }
  ]
}
```

The row's `id` is local to the profile; `plugin` must equal the installed package name; `scope` must name a declared scope. The package's manifest supplies the version and the Native entry. A missing package, a version-less manifest, an invalid `dsh.native` declaration, or a service requirement without a Provider fails before the application starts.

Keep the rest of the shipped composition when adding the row: the profile boots exactly the installations in this file. `--dump-config` prints the resolved composition without starting the application:

```sh
dsh --profile demo --dump-config
dsh --profile demo
```

## Overlays

`--patch <file.json>` applies a versioned JSON overlay after the profile's own file, in argv order. A row without `plugin` replaces fields on an existing installation, and a present `config` replaces the complete prior value rather than merging keys. A row with `plugin` inserts a new installation into an existing scope. Use an overlay to try a configuration change without editing the profile:

```json
{
  "formatVersion": 1,
  "installations": [
    { "id": "hello", "config": { "greeting": "hi" } }
  ]
}
```

```sh
dsh --profile demo --patch ./hello-overlay.json
```

Unknown targets, duplicate ids, and unknown scopes are rejected. `native-web` reads explicit JSON overlays through the same rule on live reload.

## Installing from GitHub

Publishing to a registry is not required — `pnpm add github:you/hello-plugin` works from the profile directory. A git install fetches sources, not built artifacts, so a TypeScript package needs a `prepare` script that builds its published entry points without assuming a sibling monorepo checkout. pnpm ≥10 refuses to run that script until the profile allows it:

```yaml
# $RSH_HOME/profiles/demo/pnpm-workspace.yaml
allowBuilds:
  dsh-hello-plugin: true
```

Treat that allowance as permission to execute the package's code on your machine at install time, outside any sandbox the agent runs under. Pin a commit (`github:you/hello-plugin#<sha>`) so a later push cannot silently change what runs. Publishing built artifacts to npm or shipping a tarball avoids the build permission entirely.

## Next steps

- [Plugins and lifecycle](../framework/index.md) — the Native plugin lifecycle
- [CLI behavior reference](../../../../Programs/CLI/reference/README.md) — profile composition, patches, and dumps
