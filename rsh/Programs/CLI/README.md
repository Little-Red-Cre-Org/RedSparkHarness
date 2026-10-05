# `@deepseek-ai/dsh`

English | [中文](README.zh.md)

The `dsh` command is the sole supported Node application launcher: profiles are ordered stacks of plugin-bundle patch layers under the user's own overrides. SDK and ACP are profiles, not separate public bins. The Python runtime wheel packages this same command; the SDK defaults to `sdk`, and the minimal example selects `sdk-minimal`. On Windows, the optional `rsh` shell shim routes to the source `dsh --profile rsh` launcher and adds no second Node application surface. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$DSH_HOME/profiles/<name>`. |
| `dsh --profile <name> --from-default-profile <template>` | Create a new custom profile from a shipped template, then boot it. |
| `dsh --profile acp` | Serve automation clients over ACP stdio until disconnect. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh --profile rsh` | Open the persistent RedSpark terminal session. |
| `dsh --profile sdk` | Serve SDK clients over JSON-RPC stdio until shutdown or disconnect. |
| `dsh --profile sdk-minimal` | Serve SDK clients with the standalone minimal agent tree. |
| `dsh web` | Alias of `--profile web`. |
| `dsh plugin --profile <name> <pnpm args>` | Manage a profile's plugins by forwarding to pnpm in the profile directory. |

The invoking directory is the default workspace root. The `web`, `rsh`, `headless`, `sdk`, `sdk-minimal`, and `acp` profiles auto-initialize on first use from shipped templates. Create another profile at an unused, non-shipped name with `--from-default-profile`, or initialize a base-backed profile through `dsh plugin`. The `desktop` name is reserved for the Electron-owned profile, so the CLI rejects boot, config-dump, and plugin-management requests for it.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted profile, where any injected app plugin may parse the shared immutable snapshot ([`dsh-cmdline`](../../Compatibility/DSH/boot/cmdline/README.md)). The first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile rsh --resume <id>     # --resume belongs to the RedSpark terminal app
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="profiles"></a>
## Profiles

A profile directory holds a `package.json` (out-of-tree plugin dependencies plus the profile manifest `dsh.profile` with its ordered `bundles` list and `patchReload` lifecycle) and a `cordis.patch.yml` (the user's own patch layer). `patchReload: live` watches the profile and home-level patch files; `startup` applies them once.

Selecting a shipped `native-*` profile creates its native profile files on first use; an existing profile keeps its configuration.

A native profile instead declares `dsh.profile.runtime: "native"` and `config: "rsh.profile.json"` in its package manifest. Its versioned JSON file lists scope identities and plugin installations, each with an id, package name, scope and complete config. Native `--patch` files are versioned JSON overlays that replace an existing installation's config or `disabled` value in argument order. The launcher validates every selected package's `dsh.native` metadata before importing entries, refuses nonempty Cordis patch layers, and starts one selected native application. See [native headless](../../Engine/core/native-headless/README.md) for the available one-shot application.

The CLI's native launcher depends on the native runtime directly. Cordis, profile boot, config dump, and profile package-management dependencies are optional packages; ordinary installs include them, while native-only deployments may omit optional dependencies. A legacy profile or legacy-only CLI mode then reports the required installation change before importing Cordis. Native profile plugins remain dependencies of the selected profile.

Host profiles capture inherited, invoking-directory and Harness-home environment layers before plugin imports. The same checked loader serves compatibility boot; every root scope owns the real launch snapshot Provider. Client-only profiles do not install it.

The tree composes over an empty root:
- each bundle's patch in `dsh.profile.bundles` order
- then the profile's `cordis.patch.yml`, then the home-level `$DSH_HOME/cordis.patch.yml`
- then `--patch` overlays

Bundles named in `dsh.profile.bundles` resolve from the dsh installation first (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-rsh`, `@deepseek-ai/dsh-headless`, `@deepseek-ai/dsh-sdk-app`, `@deepseek-ai/dsh-sdk-minimal`, `@deepseek-ai/dsh-acp-app`), then from the profile's own `node_modules`, where pnpm installs out-of-tree plugins.

Use `--dump-default-config` and `--dump-config` to inspect the composed tree without booting it.

The [CLI behavior reference](reference/README.md) owns exact layer precedence, flags, shutdown behavior, deployment defaults, and source execution.

## Optional overlays

`config/examples/` ships opt-in overlays for GitHub review webhooks, session-local Schedule, memory MCP servers, and runtime Cordis tools. They are never part of a default profile; the [user guides](../../Docs/user/guide/index.md) and [developer practice guides](../../Docs/user/develop/practice/index.md) own setup and safety instructions.

## Development

The [built-entry tests](tests/built-bin.e2e.ts) require `lib/bin.js` when `DSH_EXAMPLE_MODE=lib`; a missing entry fails instead of skipping the suite. Outside explicit built mode, an unbuilt checkout may skip these tests.

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
