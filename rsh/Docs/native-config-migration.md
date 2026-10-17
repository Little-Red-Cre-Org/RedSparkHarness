# Native configuration migration

English | [中文](native-config-migration.zh.md)

Use this reference when a profile selects the Native CLI runtime and older profile fields, `settings.yaml` values, or launch variables need a native destination. Native startup reads legacy settings before loading plugins, migrates only the supported values below, and leaves `settings.yaml` unchanged.

## Profile runtime markers

A profile without `package.json` remains legacy for initialization. An existing manifest selects legacy when `dsh.profile.runtime` is `legacy`, or when it has a `dsh.profile.bundles` array and no runtime marker or native config fields. A manifest with neither a valid native marker nor a legacy bundle array fails with instructions to declare `runtime: "native"` and `config: "rsh.profile.json"`, or `bundles: [...]`. A bundle array with `config` or `configReload` and no runtime marker also fails. A legacy marker cannot include `config` or `configReload`; a native marker requires `config: "rsh.profile.json"` and cannot include Cordis `bundles` or `patchReload`.

The Native CLI checks configuration for installed, enabled plugins in `rsh.profile.json` and the Client profile selected by an installed `@deepseek-ai/dsh-native-web-host` `config.projectDir`. Without that Host installation, the profile has no Client surface. It checks a settings key only when its owning plugin is installed. A profile without the settings-file Provider has no `settings.yaml` checks. Profile templates and the legacy app-boot initializer write explicit runtime markers when they initialize a profile.

## `settings.yaml` values

The settings document path follows the active `@deepseek-ai/dsh-settings-file` installation config after ordered `--patch` overlays. Surface selection also uses that effective composition. Supported migrations write to the original persistent Native profile or Client JSON file only when the target is unset; patch files are never written. A target already equal to the migration value is skipped. Any other persisted target value stops startup with both values and the exact source and target file keys in the conflict diagnostic. The CLI validates all selected migrations before writing either file and prints one stderr line for each value it writes.

| Legacy setting | Checked when this plugin is installed | Native handling |
|---|---|---|
| `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` | Leave it in `settings.yaml`; Native pi-ai reads the same namespace and validates its fields. |
| `web-search-deepseek` | `@deepseek-ai/dsh-web-search-deepseek` | Leave it in `settings.yaml`; the Native provider reads the same namespace. |
| `ui-conversation.busyEnter` | `@deepseek-ai/dsh-native-web-session-controller` | Leave it in `settings.yaml`; Native Web reads the same field. |
| `agent-default-model.provider` | `@deepseek-ai/dsh-native-web-session-controller` | Leave it in `settings.yaml`; Native Web reads the same field. |
| `agent-default-model.model` | `@deepseek-ai/dsh-native-web-session-controller` | Leave it in `settings.yaml`; Native Web reads the same field. |
| `agent-default-model.reasoningEffort` | `@deepseek-ai/dsh-native-web-session-controller` | Error: this field is deleted; remove it. |
| `agent-presets.default` | `@deepseek-ai/dsh-agent-presets` | Migrate a ready preset id to that installation's `config.default` in `rsh.profile.json`; error when the id is missing or still uses `agent.cordis.yml`. |
| `permission.defaultPreset` | `@deepseek-ai/dsh-native-sandbox-policy` | Migrate `read-only` or `workspace-write` to sandbox `config.mode` and approval `config.policy: "ask"`; migrate `danger-full-access` to sandbox `config.mode` and approval `config.policy: "never"`. Other values error. |
| `locale.preference` | `@deepseek-ai/dsh-client-locale` in `rsh.client.json` | Migrate `en` or `zh` to Client `config.locale`. Leave `system` unset so the Client follows the browser language; an explicitly set Native locale conflicts. Other values error. |
| `ui-theme.preference` | `@deepseek-ai/dsh-client-ui-theme` in `rsh.client.json` | Migrate `light`, `dark`, or `system` to Client `config.preference`. |
| `llm-deepseek` | `@deepseek-ai/dsh-llm-deepseek` | Error: move provider values to `llm-pi-ai.providers`, or install `@deepseek-ai/dsh-llm-deepseek` and put them in its `rsh.profile.json` installation config. |
| `agent-loop.maxParallelToolCalls` | `@deepseek-ai/dsh-native-agent` | Error: Native has no parallel-call limit setting; remove this key. |
| `subagent-model-selection.*` | `@deepseek-ai/dsh-tool-subagent` | Error: move `provider` and `model` to that installation's `config.provider` and `config.model`; remove `enabled` and `allowedModels`, which have no Native equivalent. |
| `agent-presets.modeSelectionEnabled` | `@deepseek-ai/dsh-agent-presets` | Error: this field is deleted; remove it. |
| `shell` | `@deepseek-ai/dsh-bash-sandbox`, `@deepseek-ai/dsh-pwsh-sandbox`, `@deepseek-ai/dsh-bash-local`, or `@deepseek-ai/dsh-pwsh-local` | Error: remove this namespace; set the applicable Native shell config on the selected installation. |
| `ui-theme.fontSize` | `@deepseek-ai/dsh-client-ui-theme` in `rsh.client.json` | Error: it has no persistent Native profile setting; remove it. |
| `ui-chat.transcriptView` | `@deepseek-ai/dsh-client-ui-chat` in `rsh.client.json` | Error: this field is deleted; remove it. |
| `ui-pet` | `@deepseek-ai/dsh-client-ui-pet` in `rsh.client.json` | Error: this namespace is deleted; remove it. |
| `ui-onboarding` | `@deepseek-ai/dsh-client-ui-settings-general` in `rsh.client.json` | Error: this namespace is deleted; remove it. |

Unlisted namespaces and fields are not migration inputs. A conflict leaves both Native files untouched. The migration never deletes or edits the old settings document, so a legacy profile can continue to use it.

## Launch environment

The Native CLI checks the inherited process layer for process-only variables below. `.env` files continue to reject bootstrap-only `DSH_*` variables before profile startup.

| Variable | Checked when this plugin or app is installed | Native handling |
|---|---|---|
| `DSH_PERMISSION_MODE` | `@deepseek-ai/dsh-native-sandbox-policy` | Error: remove it and set sandbox `config.mode` plus approval `config.policy` in `rsh.profile.json`. |
| `DSH_TOOLS_MODE` | `@deepseek-ai/dsh-native-headless` or `@deepseek-ai/dsh-native-web-host` | Error: select tools through `rsh.profile.json` installations and remove this variable. |
| `DSH_CONTEXT_WINDOW` | `@deepseek-ai/dsh-llm-pi-ai` | Error: this variable is deleted; set the provider context window in that installation's `config.providers.<provider>.models[].contextWindow`. |
| `DSH_SYSTEM_PROMPT` | `@deepseek-ai/dsh-native-sdk-server` | Error: this variable is deleted; remove it. |
| `DSH_MAX_TOKENS_AS_SUCCESS` | `@deepseek-ai/dsh-native-sdk-server` | Error: this variable is deleted; remove it. |
| `DSH_TUI_BG` | `@deepseek-ai/dsh-native-tui` | Error: this variable is deleted; remove it. |
| `DSH_TELEMETRY_MODE` | `@deepseek-ai/dsh-session-telemetry-otel` | `DISABLED` passes through; other values error and must move to installation `config.mode`. |
| `DSH_TELEMETRY_OTLP_URL` | `@deepseek-ai/dsh-session-telemetry-otel` | Error: set installation `config.exporter.url` in `rsh.profile.json`. |
| `CORDIS_SHARED` | Every Native CLI launch | Error: Native does not use the Cordis Loader; remove this variable. |
Native CLI startup refuses a nonempty `$DSH_HOME/profiles/<name>/cordis.yml` and nonempty Cordis patch files. Native `--patch` accepts only `{formatVersion:1, installations:[…]}` JSON. `--dump-config` does not run the settings migration.

## Global proxy

Native CLI startup resolves the process proxy from the launch environment snapshot and installs it before loading profile plugins. The same global dispatcher covers Native model and tool HTTP requests. Overlapping launches share one installation, which the last Host shutdown releases. See the [network proxy guide](user/guide/network-proxy.md) for the supported proxy variables and routes.

## Resolve a conflict

Use the exact source or target file and key named in the conflict diagnostic. Keep the Native value by removing the matching legacy setting, or set the Native key to the value produced by that legacy setting and start again. The migration document describes the source setting and Native target for each supported key.

See the [CLI behavior reference](../Programs/CLI/reference/README.md) for profile startup and patch behavior.
