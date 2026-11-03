# Native configuration migration

English | [中文](native-config-migration.zh.md)

Use this reference when a profile selects the Native CLI runtime and older profile fields, `settings.yaml` values, or launch variables need a native destination. Native startup reads legacy settings before loading plugins, migrates only the supported values below, and leaves `settings.yaml` unchanged.

## Profile runtime markers

New profiles named `headless`, `web`, `sdk`, `acp`, or `rsh` initialize as `native-headless`, `native-web`, `native-sdk`, `native-acp`, or `native-tui`, respectively, while keeping the requested profile directory name. The eight `native-*` names remain explicit aliases, and `sdk-minimal` remains a legacy bundle profile. Other profiles retain their legacy initialization behavior. For any existing `package.json`, the runtime resolver honors its profile marker and bundle list without rewriting the profile: `runtime: "legacy"` or a `dsh.profile.bundles` array without native fields selects legacy; a native marker selects Native. A manifest with neither a valid native marker nor a legacy bundle array fails with instructions to declare `runtime: "native"` and `config: "rsh.profile.json"`, or `bundles: [...]`. A bundle array with `config` or `configReload` and no runtime marker also fails. A legacy marker cannot include `config` or `configReload`; a native marker requires `config: "rsh.profile.json"` and cannot include Cordis `bundles` or `patchReload`.

The Native CLI checks configuration for installed, enabled plugins in `rsh.profile.json` and the Client profile selected by an installed `@redspark/rsh-native-web-host` `config.projectDir`. Without that Host installation, the profile has no Client surface. It checks a settings key only when its owning plugin is installed. A profile without the settings-file Provider has no `settings.yaml` checks. Profile templates and the legacy app-boot initializer write explicit runtime markers when they initialize a profile.

## `settings.yaml` values

The settings document path follows the active `@redspark/rsh-settings-file` installation config after ordered `--patch` overlays. Surface selection also uses that effective composition. Supported migrations write to the original persistent Native profile or Client JSON file only when the target is unset; patch files are never written. A target already equal to the migration value is skipped. Any other persisted target value stops startup with both values and the exact source and target file keys in the conflict diagnostic. The CLI validates all selected migrations before writing either file and prints one stderr line for each value it writes.

| Legacy setting | Checked when this plugin is installed | Native handling |
|---|---|---|
| `llm-pi-ai` | `@redspark/rsh-llm-pi-ai` | Leave it in `settings.yaml`; Native pi-ai reads the same namespace and validates its fields. |
| `web-search-deepseek` | `@redspark/rsh-web-search-deepseek` | Leave it in `settings.yaml`; the Native provider reads the same namespace. |
| `ui-conversation.busyEnter` | `@redspark/rsh-native-web-session-controller` | Leave it in `settings.yaml`; Native Web reads the same field. |
| `agent-default-model.provider` | `@redspark/rsh-native-web-session-controller` | Leave it in `settings.yaml`; Native Web reads the same field. |
| `agent-default-model.model` | `@redspark/rsh-native-web-session-controller` | Leave it in `settings.yaml`; Native Web reads the same field. |
| `agent-default-model.reasoningEffort` | `@redspark/rsh-native-web-session-controller` | Error: this field is deleted; remove it. |
| `agent-presets.default` | `@redspark/rsh-agent-presets` | Migrate a ready preset id to that installation's `config.default` in `rsh.profile.json`; error when the id is missing or still uses `agent.cordis.yml`. |
| `permission.defaultPreset` | `@redspark/rsh-native-sandbox-policy` | Migrate `read-only` or `workspace-write` to sandbox `config.mode` and approval `config.policy: "ask"`; migrate `danger-full-access` to sandbox `config.mode` and approval `config.policy: "never"`. Other values error. |
| `locale.preference` | `@redspark/rsh-client-locale` in `rsh.client.json` | Migrate `en` or `zh` to Client `config.locale`. Leave `system` unset so the Client follows the browser language; an explicitly set Native locale conflicts. Other values error. |
| `ui-theme.preference` | `@redspark/rsh-client-ui-theme` in `rsh.client.json` | Migrate `light`, `dark`, or `system` to Client `config.preference`. |
| `llm-deepseek` | `@redspark/rsh-llm-deepseek` | Error: move provider values to `llm-pi-ai.providers`, or install `@redspark/rsh-llm-deepseek` and put them in its `rsh.profile.json` installation config. |
| `agent-loop.maxParallelToolCalls` | `@redspark/rsh-native-agent` | Error: Native has no parallel-call limit setting; remove this key. |
| `subagent-model-selection.*` | `@redspark/rsh-tool-subagent` | Error: move `provider` and `model` to that installation's `config.provider` and `config.model`; remove `enabled` and `allowedModels`, which have no Native equivalent. |
| `agent-presets.modeSelectionEnabled` | `@redspark/rsh-agent-presets` | Error: this field is deleted; remove it. |
| `shell` | `@redspark/rsh-bash-sandbox`, `@redspark/rsh-pwsh-sandbox`, `@redspark/rsh-bash-local`, or `@redspark/rsh-pwsh-local` | Error: remove this namespace; set the applicable Native shell config on the selected installation. |
| `ui-theme.fontSize` | `@redspark/rsh-client-ui-theme` in `rsh.client.json` | Error: it has no persistent Native profile setting; remove it. |
| `ui-chat.transcriptView` | `@redspark/rsh-client-ui-chat` in `rsh.client.json` | Error: this field is deleted; remove it. |
| `ui-pet` | `@redspark/rsh-client-ui-pet` in `rsh.client.json` | Error: this namespace is deleted; remove it. |
| `ui-onboarding` | `@redspark/rsh-client-ui-settings-general` in `rsh.client.json` | Error: this namespace is deleted; remove it. |

Unlisted namespaces and fields are not migration inputs. A conflict leaves both Native files untouched. The migration never deletes or edits the old settings document, so a legacy profile can continue to use it.

## Launch environment

The Native CLI checks the inherited process layer for process-only variables below. `.env` files continue to reject bootstrap-only `RSH_*` variables before profile startup.

| Variable | Checked when this plugin or app is installed | Native handling |
|---|---|---|
| `RSH_PERMISSION_MODE` | `@redspark/rsh-native-sandbox-policy` | Error: remove it and set sandbox `config.mode` plus approval `config.policy` in `rsh.profile.json`. |
| `RSH_TOOLS_MODE` | `@redspark/rsh-native-headless` or `@redspark/rsh-native-web-host` | Error: select tools through `rsh.profile.json` installations and remove this variable. |
| `RSH_CONTEXT_WINDOW` | `@redspark/rsh-llm-pi-ai` | Error: this variable is deleted; set the provider context window in that installation's `config.providers.<provider>.models[].contextWindow`. |
| `RSH_SYSTEM_PROMPT` | `@redspark/rsh-native-sdk-server` | Error: this variable is deleted; remove it. |
| `RSH_MAX_TOKENS_AS_SUCCESS` | `@redspark/rsh-native-sdk-server` | Error: this variable is deleted; remove it. |
| `RSH_TUI_BG` | `@redspark/rsh-native-tui` | Error: this variable is deleted; remove it. |
| `RSH_TELEMETRY_MODE` | `@redspark/rsh-session-telemetry-otel` | `DISABLED` passes through; other values error and must move to installation `config.mode`. |
| `RSH_TELEMETRY_OTLP_URL` | `@redspark/rsh-session-telemetry-otel` | Error: set installation `config.exporter.url` in `rsh.profile.json`. |
| `CORDIS_SHARED` | Every Native CLI launch | Error: Native does not use the Cordis Loader; remove this variable. |
Native CLI startup refuses a nonempty `$RSH_HOME/profiles/<name>/cordis.yml` and nonempty Cordis patch files. Native `--patch` accepts only `{formatVersion:1, installations:[…]}` JSON. `--dump-config` does not run the settings migration.

## Global proxy

Native CLI startup resolves the process proxy from the launch environment snapshot and installs it before loading profile plugins. The same global dispatcher covers Native model and tool HTTP requests. Overlapping launches share one installation, which the last Host shutdown releases. See the [network proxy guide](user/guide/network-proxy.md) for the supported proxy variables and routes.

## Resolve a conflict

Use the exact source or target file and key named in the conflict diagnostic. Keep the Native value by removing the matching legacy setting, or set the Native key to the value produced by that legacy setting and start again. The migration document describes the source setting and Native target for each supported key.

See the [CLI behavior reference](../Programs/CLI/reference/README.md) for profile startup and patch behavior.
