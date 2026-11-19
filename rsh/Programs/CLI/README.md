# `@redspark/rsh`

English | [中文](README.zh.md)

The `dsh` command is the sole supported Node application launcher. Every profile boots a Native composition from `$RSH_HOME/profiles/<name>`; SDK and ACP are profiles, not separate public bins. The Python runtime wheel packages this same command. On Windows, the optional `rsh` shell shim routes to the source `dsh --profile rsh` launcher and adds no second Node application surface. [`src/args.ts`](src/args.ts) owns the command grammar, and [`src/bin.ts`](src/bin.ts) loads only the selected runner. Invalid commands, options from another mode, configuration errors, and boot failures exit nonzero.

## Entry modes

| Command | Purpose |
|---|---|
| `dsh --profile <name>` | Boot the named profile under `$RSH_HOME/profiles/<name>`. |
| `dsh --profile <name> --from-default-profile <template>` | Create a new custom profile from a shipped template, then boot it. |
| `dsh --profile acp` | Serve automation clients over ACP stdio until disconnect. |
| `dsh --profile headless "job"` | Run one fresh persisted session, print the final answer, and exit. |
| `dsh --profile native-headless-query "job"` | Run a Native headless session with workspace-authorized tools for prior session history. |
| `dsh --profile rsh` | Open the persistent RedSpark terminal session. |
| `dsh --profile sdk` | Serve SDK clients over JSON-RPC stdio until shutdown or disconnect. |
| `dsh --profile native-sdk` | Serve text and image SDK turns, live model chunks, Session cancellation, next-step steering and closed-turn forks over JSON-RPC stdio. |
| `dsh --profile native-acp` | Drive native text/image Sessions, model configuration, cancellation, and durable resume over standard ACP stdio. |
| `dsh --profile sdk-minimal` | Refused. Use `dsh --profile sdk`. Existing directories are not rewritten. |
| `dsh web` | Alias of `--profile web`. |

The invoking directory is the default workspace root. New `headless`, `web`, `sdk`, `acp`, and `rsh` profiles initialize as `native-headless`, `native-web`, `native-sdk`, `native-acp`, and `native-tui` while retaining the requested profile name. The eight `native-*` templates remain explicit alternatives. The launcher refuses `sdk-minimal` on boot, config dump, and `--from-default-profile`. An existing profile keeps its files and is never rewritten by this initialization; a manifest that does not select Native execution is refused with a pointer to [native configuration migration](../../Docs/native-config-migration.md). The `desktop` name is reserved for the Electron-owned profile, so the CLI rejects boot and config-dump requests for it.

The native-headless, native-headless-query, native-tui, and native-web session defaults select the installed pi-ai route `deepseek` with model `deepseek-flash`. Native ACP keeps its explicit `deepseek-official` route.

The native-sdk profile also composes native-tools, native-prompt, native-subagent, native-jobs and their tool Consumers. Its child execution uses the same selected Program executor, Session storage and model Provider. The profile installs continuable Subagent support: `subagent` starts a persistent child, `send_message` sends follow-up work, and `interrupt_agent` stops its current turn. One-shot background children use `job_output`/`job_kill`.

The `native-sdk`, `native-sdk-dsh-child`, `native-acp`, and `native-acp-dsh-child` compositions install workspace instructions through each process's selected filesystem Provider. The `native-sdk-dsh-child` profile uses a CLI-private fixed launcher to start the same-version `native-sdk` profile; the opt-in `dsh-sdk` child resolves project instructions from its requested cwd and uses its own private RSH_HOME.

Native profiles may opt in to the `dsh-sdk` or `dsh-acp-child` external driver. The CLI supplies each driver's fixed same-version launcher and resolves its route catalog from the nearest visible pi-ai Provider; the ACP launcher accepts no caller-selected executable or arbitrary argv and its child profile cannot launch another child. These adapters remain explicit profile installations, and the shipped `native-sdk` and `native-acp` profiles do not select them.

## App arguments

The launcher parses only its own flags and hands everything after them to the booted application. The first token the launcher does not recognize starts the app's arguments:

```sh
dsh --profile web                          # Native Web, default flags only
dsh --profile headless "run the tests"
dsh --profile rsh --resume <id>            # --resume belongs to the terminal app
dsh --profile web --help                   # the web app's flags, not the launcher's
dsh --help                                 # the launcher's own help
```

Native Web rejects `--host`, `--port`, and `--no-open`; deployment values belong in the profile's `rsh.client.json` and `rsh.profile.json`.

<a id="profiles"></a>
## Profiles

A Native profile declares `dsh.profile.runtime: "native"` and `config: "rsh.profile.json"` in its package manifest. The versioned JSON file lists scope identities and plugin installations, each with an id, package name, scope and complete config. `--patch` files are versioned JSON overlays that replace an installation's config or `disabled` value, or insert an installation that names an existing scope, in argument order. The launcher requires every selected package manifest to declare non-empty npm `name` and `version` fields, validates its `dsh.native` metadata before importing entries, refuses nonempty Cordis patch layers, and starts one selected native application. See [native headless](../../Engine/core/native-headless/README.md) for the available one-shot application.

The `./native-profile` library export shares validated profile parsing, preset expansion, child-route derivation, and installation planning with the private Desktop Host. It accepts an explicit installed profile directory and optional allowed package roots; it exposes no application launcher or argv API. Shipped profile names come from the CLI package's `./package.json` export, keeping that manifest as their single source.

Selecting a shipped native profile name creates its Native profile files on first use; an existing profile keeps its configuration. `--from-default-profile` copies a shipped template into a new custom name:

```sh
dsh --profile rescue --from-default-profile web
dsh --profile rescue
```

The target name must not be a shipped profile name, and its directory must be empty or absent. A failed copy or boot leaves the created profile on disk, so retry without the creation option. Unknown template diagnostics name every accepted template, and `--dump-config` accepts the option and prints the copied composition without booting it.

The shipped `native-web` profile installs the `standard` and `minimal` agent modes, the plan-mode Provider, and the standing permission presets `workspace-write` and `danger-full-access` for its Native Session API.

The ordinary `native-headless` template also records the invoking directory as the application's workspace root on first initialization. Select `native-headless-query` explicitly to install the combined SQLite session-query provider and the five Native workspace-authorized tools. On first initialization, that profile records the invoking directory as the application's workspace root. It stores its index at `$RSH_HOME/sessions/query.sqlite` and opens it on the first search; edit its `session-query` installation to change the path or set `openAt: "never"` while keeping exact reads available.

Both shipped headless templates include a disabled `tmux-context` installation. Enable it with a profile overlay and compose a `shell` Provider to add the current pane location as durable model context; the [Native tmux-context README](../../Modules/Official/terminal/native-tmux-context/README.md) documents its requirements and message.

Native startup checks legacy-only settings and launch variables for installed plugins, copies supported settings into native profile files, and installs the launch proxy before loading plugins. See the [native configuration migration reference](../../Docs/native-config-migration.md) for accepted values and errors.

Host profiles capture inherited, invoking-directory and Harness-home environment layers before plugin imports. Each Host root scope owns the real launch snapshot Provider and a `pluginInventory` Provider that lists the running Host's installation states. Client-only profiles install neither.

## Optional overlays

`config/examples/` ships opt-in Cordis overlays for GitHub review webhooks, session-local Schedule, and memory MCP servers used by the Web application tests and legacy compositions. They are never part of a default Native profile; the [user guides](../../Docs/user/guide/index.md) own setup and safety instructions. Native profiles express the same capabilities as `rsh.profile.json` installations.

## Development

The [built-entry tests](tests/built-bin.e2e.ts) require `lib/bin.js` when `RSH_EXAMPLE_MODE=lib`; a missing entry fails instead of skipping the suite. The shipped native-headless loader check also requires built native plugin entries. Run it after `pnpm run build`; an unbuilt checkout may skip these tests outside explicit built mode.

Production runs require built package and frontend artifacts. From the repository root, run `pnpm run build` separately, then use `pnpm dsh <args...>` to run the TypeScript entry and forward every argument; the [source-execution reference](reference/README.md#source-execution) owns the module-resolution contract.
