# `dsh` CLI behavior reference

English | [中文](README.zh.md)

This reference defines the profile, web-alias, patch, and config-dump command modes. Argv is parsed once through [`src/args.ts`](../src/args.ts), and [`src/bin.ts`](../src/bin.ts) dynamically imports only the selected runner.

## Profile boot

`dsh --profile <name>` boots the Native profile at `$RSH_HOME/profiles/<name>`. The launcher resolves the profile manifest's Native runtime marker and `rsh.profile.json`, applies each `--patch <path>` overlay in argv order, and starts the one selected application. A row carrying `plugin` inserts an installation into an existing scope; a row without it replaces fields on an existing installation, and a present `config` replaces the complete prior value rather than merging keys. The profile's own `dsh.profile.configReload` selects `live` file watching or `startup` one-time loading. A parse, schema, resolution, package, or plugin boot failure is reported and exits nonzero. SIGINT and SIGTERM dispose the mounted root before exit.

The standard names `headless`, `web`, `sdk`, `acp`, and `rsh` initialize Native compositions on first use: `native-headless`, `native-web`, `native-sdk`, `native-acp`, and `native-tui`, respectively. The requested name remains the profile directory name, including the Web project and scheduler database paths. The eight `native-*` names remain explicit aliases. The launcher refuses the profile name `sdk-minimal` on boot, dump, and `--from-default-profile`; use `--profile sdk`. Existing directories are not rewritten. A manifest that does not declare Native execution is refused with a pointer to the [native configuration migration reference](../../../Docs/native-config-migration.md); the launcher no longer composes Cordis profiles.

A profile package must declare non-empty npm `name` and `version` fields and valid `dsh.native` metadata. The launcher validates every selected installation's package name against the profile's declared scopes before importing entries. A nonempty Cordis patch layer is refused rather than applied.

### Native profile reload

The shipped `native-web` profile selects `dsh.profile.configReload: live`; it watches that profile's `rsh.profile.json` and explicit JSON files passed with `--patch`. The CLI validates a candidate composition before replacing the running Native Host, reuses unchanged installation identities, drains an affected application run, and starts the application from the active generation. A malformed or unresolvable candidate leaves the current graph running. An independent application failure remains fatal with its original diagnostic, even during candidate preflight; only the invocation's exact abort reason or a pre-callback Host admission rejection during replacement is treated as a replaced run. A Host activation, cleanup, or watcher failure stops the process without reviving the old graph. The `native-headless`, `native-sdk`, `native-acp`, and `native-tui` profiles remain startup-only. This watches profile data, not package source; Web Client asset rebuilding remains separate.

Native profile runtime markers and the CLI's settings/environment migration rules are listed in the [native configuration migration reference](../../../Docs/native-config-migration.md). Native startup installs the configured global proxy before loading profile plugins and disposes it after Host shutdown.

### Template initialization

`dsh --profile <name> --from-default-profile <template>` explicitly initializes a new profile from one of the shipped Native templates: the five standard aliases or one of the eight `native-*` names. The name `sdk-minimal` is refused before boot. Use a custom target name such as `rescue`; the target name cannot be a shipped profile name, and its complete profile directory must be absent or empty. The launcher claims that directory exclusively, so residual files and another concurrent creator are rejected without modification. It writes the template's Native composition for the requested platform, plus `rsh.client.json` for `native-web`. The target name is recorded as the profile name; later template-list changes do not rewrite the new profile.

An existing profile rejects `--from-default-profile` without changing or booting it; omit the option to use it. A residual target directory is also preserved and requires a different profile name. An unknown template or a shipped target name fails before creating the target. Unknown-template diagnostics name the valid templates. Initialization is committed before bundle resolution and application boot, so a later failure leaves the new profile on disk and the retry omits the creation option. `--dump-config` accepts the option, initializes the target, and prints the requested tree without booting it.

```sh
dsh --profile rescue --from-default-profile web
dsh --profile rescue
```

## App arguments

The launcher's flags come first and end at the first token it does not recognize; everything from there on is handed to the booted application verbatim. Native Web has no app-argument parser and rejects `--host`, `--port`, and `--no-open`. Launcher flags must come before app arguments, and the launcher's parser consumes one `--`: an app argument that must arrive as a literal `--` needs `-- --`. A first app argument equal to `web` selects the alias instead.

The shipped applications own these command lines:

| Profile | Arguments |
|---|---|
| `web` | the web app's own flags; `--host`, `--port`, and `--no-open` are rejected |
| `headless` | the task text, as the positional argument |
| `sdk`, `native-sdk` | no options; stdio carries the JSON-RPC protocol |
| `acp`, `native-acp` | no options; stdio carries ACP (Agent Client Protocol) |
| `rsh` | the terminal app's flags, such as `--resume <id>` |
| `sdk-minimal` | Refused. Use `--profile sdk`. |

A one-shot task (`dsh --profile headless "run the tests"`) creates one fresh persisted Agent through the core registry, submits the task, waits for quiescence, and flushes the Session before deriving the last non-empty assistant text and final `turn/end` reason from its durable interval. It streams non-empty provider reasoning deltas to stderr under a `dsh: reasoning:` heading, prints only the final text on stdout, and exits 0 for `completed`, else 1; a successful response with no reasoning leaves stderr empty. An invocation with no task is a usage error from that app. The shipped headless profile mounts no browser Connection, HTTP server, Web runtime, or browser client, and opens no listening port.

## Config dumps

`--dump-config` prints the resolved Native profile JSON, including the profile's own layer and each `--patch` overlay, without booting it. A dump initializes missing profile files but does not prepare the runtime module fallback under `$RSH_HOME/profiles/node_modules`. It never runs app command-line providers, so it rejects an invocation that carries app arguments.

```sh
dsh --profile rescue --from-default-profile web --dump-config
dsh --profile rescue --patch ./extra.json --dump-config
```

## Web alias

`dsh web` is a hardcoded alias for `--profile web`.

```sh
dsh web
dsh web --dump-config
dsh web --help
```

The Native Web application needs built package and frontend artifacts (`pnpm run build`). It serves `http://127.0.0.1:3080` by default and, for a local launch, opens that canonical host URL only after the complete Host tree settles. A non-empty inherited `SSH_CONNECTION` or `SSH_TTY` suppresses the browser handoff because the SSH client or editor owns the local forwarded address; the host URL is still printed. Deployment values such as the port, trusted hosts, and browser handoff are profile configuration, not launcher flags. Immediately before a local handoff it prints `dsh web: opening the default browser; pass --no-open to disable` in the legacy compatibility application; the Native Web app does not accept that flag.

Process shutdown gives the plugin tree up to five seconds to dispose. The first `SIGINT`/`SIGTERM` starts that graceful drain — `SIGTERM` is a supervisor's ordinary stop request and exits 0 on every surface, `SIGINT` reports 130; a second signal forces immediate exit. If one-shot normal completion is already stuck in disposal, the first `Ctrl+C` is the escalation and exits immediately instead of being swallowed.

Native profiles treat the invoking directory as the default workspace root, load applicable `AGENTS.md` or `CLAUDE.md` instructions with a 65,536-byte render budget, and use the installed session-content index. `native-sdk` also installs the persistent shell rows that the retired `sdk-minimal` profile provided, pinned to `danger-full-access`, so SDK clients keep a shell without filesystem tools or instruction discovery.

New sessions in base-backed profiles default to the `workspace-write` permission preset. Bash and filesystem mutations are restricted to the session workspace and platform temporary roots; reads and network access are not confined, while process visibility depends on the selected sandbox backend — bwrap runs commands in a private PID namespace that hides host processes, and Landlock and Seatbelt leave host process visibility unchanged. `RSH_PERMISSION_MODE` changes the process fallback. Stored General-settings permissions affect later Web sessions, not an already-open one.

`RSH_TOOLS_MODE` selects `native`, `ptc`, or `both` for the process; another value fails at boot. The shipped `minimal` agent preset keeps that deployment presentation, fixes the complete system prompt to `You are a helpful software engineer assistant.`, and composes only the platform-selected persistent shell. Select 极简模式 when creating a Web session; every other prompt section and model-facing plugin remains absent from that agent while the shared browser, workspace, persistence, sandbox, and permission host stays in place.

## Shared deployment behavior

Native profiles mount their model adapters, settings and credential providers, search and fetch tools, telemetry, and session-log contributions as explicit installations. Provider credentials resolve from the inherited environment, `$RSH_HOME/.credentials.yaml`, the invoking directory's `.env`, then `$RSH_HOME/.env`; the managed document is never materialized into `process.env`, while both `.env` files are ordinary launch environment layers. Search uses `DEEPSEEK_API_KEY` and accepts `DEEPSEEK_SEARCH_BASE_URL`. Enabled fetch calls run in every sandbox and approval mode without per-call confirmation; the provider rejects non-public destinations before connecting.

Feedback is recorded in the Session log without starting model work. Enable the [DeepSeek session-log contributor](../../../Modules/Official/llm/session-log-deepseek/README.md) to send complete unaccepted log suffixes with subsequent DeepSeek requests, including requests sent through configured gateways. [OTel session upload](../../../Engine/session/session-telemetry-otel/README.md) applies to all users and providers, including `deepseek-official`, without requiring a request header. The default `FEEDBACK_ONLY` mode releases the complete canonical prefix on new own text feedback, message ratings, edits, and withdrawals, including stored context; later records wait for the next explicit feedback. Inherited parent feedback does not authorize a fork. Requests, restoration, mount, and HMR do not trigger capture. SDK batching may finish an authorized upload without further interaction or model work. `RSH_TELEMETRY_MODE=DISABLED` disables OTel delivery; `FULL` is rejected, and any non-empty `RSH_TELEMETRY_DISABLED` disables its row. `RSH_TELEMETRY_OTLP_URL` selects the collector. Handoff is best-effort, not collector acceptance; no durable outbox or retry guarantee is provided. These OTel settings do not enable or disable the DeepSeek contribution. Neither path changes model input, but exports can include message text, tool arguments and results, and workspace paths.

Add external plugins as `rsh.profile.json` installations, or as a Native overlay package that contributes its own installation rows. The CLI also ships `@redspark/rsh-mcp-client` as a dependency, but no MCP server is enabled by default because each server command is trusted executable code outside the agent sandbox.

<a id="source-execution"></a>
## Source execution

From the repository root, run `pnpm run build` separately after a fresh checkout and whenever artifacts need updating, then use `pnpm dsh <args...>`. The `package.json` script launches `rsh/Programs/CLI/src/bin.ts` with `node --import tsx/esm` without building and forwards every argument. The TypeScript SDK source launcher supplies only `tsx/esm` and its tsconfig. Missing Typert host artifacts fail profile boot through module-resolution errors without a build instruction. Once those host artifacts exist, missing frontend or client-plugin bundles fail at startup with an instruction to run `pnpm run build`. The launcher does not check freshness, so existing stale bundles can run older browser code until rebuilt. The process inherits the launch environment, and `runProfile` resolves the outbound proxy from that snapshot before any entry mounts, so `HTTP_PROXY`/`HTTPS_PROXY` (and a proxy declared in a `.env` layer) apply without any further flag. The installed form launches the built `rsh/Programs/CLI/lib/bin.js` without rebuilding the repository.
