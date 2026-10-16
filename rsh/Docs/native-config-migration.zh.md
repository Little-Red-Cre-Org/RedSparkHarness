# 原生配置迁移

[English](native-config-migration.md) | 中文

当 profile 选择 Native CLI runtime，且旧 profile 字段、`settings.yaml` 值或启动变量需要迁移到 native 目标时，请查阅本文。Native 启动会在加载插件前读取旧 settings，只迁移下表支持的值，并保持 `settings.yaml` 不变。

## Profile runtime 标记

没有 `package.json` 的 profile 在初始化前仍由 resolver 视为 legacy。已存在的 manifest 在 `dsh.profile.runtime` 为 `legacy`，或无 runtime 标记、没有 native 配置字段但有 `dsh.profile.bundles` 数组时，会选择 legacy。既没有有效 native 标记也没有 legacy bundle 数组的 manifest 会报错，并要求声明 `runtime: "native"` 与 `config: "rsh.profile.json"`，或声明 `bundles: [...]`。无 runtime 标记的 bundle 数组若同时声明 `config` 或 `configReload` 也会报错。legacy 标记不能包含 `config` 或 `configReload`；native 标记必须使用 `config: "rsh.profile.json"`，且不能包含 Cordis `bundles` 或 `patchReload`。

Native CLI 检查 `rsh.profile.json` 中已安装且启用的插件，以及由已安装的 `@deepseek-ai/dsh-native-web-host` `config.projectDir` 选择的 Client profile。没有安装该 Host 时，profile 不包含 Client surface。只有安装了该键所属插件时才检查 settings。没有 settings-file Provider 的 profile 不读取或检查 `settings.yaml`。Native profile 模板与 legacy app-boot 初始化器会在初始化 profile 时写入显式 runtime 标记。

## `settings.yaml` 中的值

settings 文档路径遵循应用有序 `--patch` 后生效的 `@deepseek-ai/dsh-settings-file` 安装项配置，surface 选择也使用该有效组合。仅在目标未设置或仍等于 shipped 模板值时，支持的迁移才会写入原始持久 Native profile 或 Client JSON 文件；patch 文件不会写回。目标已等于旧值时保持不变；其他目标值会停止启动，冲突诊断会列出两边的文件路径和值。CLI 会先校验所有选定迁移，再写入任一文件，并为写入的每个值向 stderr 打一行说明。

| 旧 setting | 安装此插件时检查 | Native 处理方式 |
|---|---|---|
| `llm-pi-ai` | `@deepseek-ai/dsh-llm-pi-ai` | 保留在 `settings.yaml`；Native pi-ai 使用相同 namespace 并校验字段。 |
| `web-search-deepseek` | `@deepseek-ai/dsh-web-search-deepseek` | 保留在 `settings.yaml`；Native Provider 使用相同 namespace。 |
| `ui-conversation.busyEnter` | `@deepseek-ai/dsh-native-web-session-controller` | 保留在 `settings.yaml`；Native Web 使用相同字段。 |
| `agent-default-model.provider` | `@deepseek-ai/dsh-native-web-session-controller` | 保留在 `settings.yaml`；Native Web 使用相同字段。 |
| `agent-default-model.model` | `@deepseek-ai/dsh-native-web-session-controller` | 保留在 `settings.yaml`；Native Web 使用相同字段。 |
| `agent-default-model.reasoningEffort` | `@deepseek-ai/dsh-native-web-session-controller` | 报错：该字段已删除；请移除。 |
| `agent-presets.default` | `@deepseek-ai/dsh-agent-presets` | preset id 状态为 ready 时迁移到 `rsh.profile.json` 中该安装项的 `config.default`；id 不存在或仍使用 `agent.cordis.yml` 时会报错。 |
| `permission.defaultPreset` | `@deepseek-ai/dsh-native-sandbox-policy` | 将 `read-only` 或 `workspace-write` 迁移到 sandbox `config.mode`，并将 approval `config.policy` 设为 `"ask"`；将 `danger-full-access` 迁移到 sandbox `config.mode`，并将 approval `config.policy` 设为 `"never"`。其他值报错。 |
| `locale.preference` | `rsh.client.json` 中的 `@deepseek-ai/dsh-client-locale` | 将 `en` 或 `zh` 迁移到 Client `config.locale`。`system` 保持未设置，使 Client 跟随浏览器语言。其他值报错。 |
| `ui-theme.preference` | `rsh.client.json` 中的 `@deepseek-ai/dsh-client-ui-theme` | 将 `light`、`dark` 或 `system` 迁移到 Client `config.preference`。 |
| `llm-deepseek` | `@deepseek-ai/dsh-llm-deepseek` | 报错：将 provider 值迁移到 `llm-pi-ai.providers`，或安装 `@deepseek-ai/dsh-llm-deepseek` 并把字段写入其 `rsh.profile.json` 安装项配置。 |
| `agent-loop.maxParallelToolCalls` | `@deepseek-ai/dsh-native-agent` | 报错：Native 没有并行调用上限设置；请移除该键。 |
| `subagent-model-selection.*` | `@deepseek-ai/dsh-tool-subagent` | 报错：将 `provider` 和 `model` 迁移到该安装项的 `config.provider` 和 `config.model`；移除没有 Native 对应项的 `enabled` 和 `allowedModels`。 |
| `agent-presets.modeSelectionEnabled` | `@deepseek-ai/dsh-agent-presets` | 报错：该字段已删除；请移除。 |
| `shell` | `@deepseek-ai/dsh-bash-sandbox`、`@deepseek-ai/dsh-pwsh-sandbox`、`@deepseek-ai/dsh-bash-local` 或 `@deepseek-ai/dsh-pwsh-local` | 报错：移除该 namespace；在所选安装项中设置适用的 Native shell 配置。 |
| `ui-theme.fontSize` | `rsh.client.json` 中的 `@deepseek-ai/dsh-client-ui-theme` | 报错：它不是持久化的 Native profile 设置；请移除。 |
| `ui-chat.transcriptView` | `rsh.client.json` 中的 `@deepseek-ai/dsh-client-ui-chat` | 报错：该字段已删除；请移除。 |
| `ui-pet` | `rsh.client.json` 中的 `@deepseek-ai/dsh-client-ui-pet` | 报错：该 namespace 已删除；请移除。 |
| `ui-onboarding` | `rsh.client.json` 中的 `@deepseek-ai/dsh-client-ui-settings-general` | 报错：该 namespace 已删除；请移除。 |

未列出的 namespace 和字段不会作为迁移输入。发生冲突时，Native 文件保持不变。迁移不会删除或编辑旧 settings 文档，因此 legacy profile 仍可继续使用它。

## 启动环境

Native CLI 检查下表仅限进程层的变量是否来自继承环境。`.env` 文件仍会在 profile 启动前拒绝仅供启动配置使用的 `DSH_*` 变量。

| 变量 | 安装此插件或应用时检查 | Native 处理方式 |
|---|---|---|
| `DSH_PERMISSION_MODE` | `@deepseek-ai/dsh-native-sandbox-policy` | 报错：移除该变量，并在 `rsh.profile.json` 中设置 sandbox `config.mode` 与 approval `config.policy`。 |
| `DSH_TOOLS_MODE` | `@deepseek-ai/dsh-native-headless` 或 `@deepseek-ai/dsh-native-web-host` | 报错：通过 `rsh.profile.json` 安装项选择工具，并移除该变量。 |
| `DSH_CONTEXT_WINDOW` | `@deepseek-ai/dsh-llm-pi-ai` | 报错：该变量已删除；在此安装项的 `config.providers.<provider>.models[].contextWindow` 中设置 provider context window。 |
| `DSH_SYSTEM_PROMPT` | `@deepseek-ai/dsh-native-sdk-server` | 报错：该变量已删除；请移除。 |
| `DSH_MAX_TOKENS_AS_SUCCESS` | `@deepseek-ai/dsh-native-sdk-server` | 报错：该变量已删除；请移除。 |
| `DSH_TUI_BG` | `@deepseek-ai/dsh-native-tui` | 报错：该变量已删除；请移除。 |
| `DSH_TELEMETRY_MODE` | `@deepseek-ai/dsh-session-telemetry-otel` | `DISABLED` 放行；其他值报错，须迁移到安装项 `config.mode`。 |
| `DSH_TELEMETRY_OTLP_URL` | `@deepseek-ai/dsh-session-telemetry-otel` | 报错：在 `rsh.profile.json` 中设置安装项 `config.exporter.url`。 |
| `CORDIS_SHARED` | 每次 Native CLI 启动 | 报错：Native 不使用 Cordis Loader；请移除该变量。 |
Native CLI 会拒绝非空的 `$DSH_HOME/profiles/<name>/cordis.yml` 与 Cordis patch 文件。Native `--patch` 只接受 `{formatVersion:1, installations:[…]}` JSON。`--dump-config` 不执行 settings 迁移。

## 全局代理

Native CLI 启动会从启动环境快照解析进程代理，并在加载 profile 插件前安装它。同一个全局 dispatcher 会代理 Native 模型与工具的 HTTP 请求。Host 关闭后，CLI 会释放 dispatcher。支持的代理变量与路由见[网络代理指南](user/guide/network-proxy.zh.md)。

## 处理冲突

打开冲突诊断指出的文件并选择一个值。要保留 Native 值，就移除对应的旧 setting；要保留旧值，就将 Native 安装项配置改为旧值后重新启动。本文列出每个受支持旧键及其 Native 目标。

Profile 启动与 patch 行为见[dsh CLI 行为参考](../Programs/CLI/reference/README.zh.md)。
