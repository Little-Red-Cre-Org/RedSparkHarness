---
description: "极简 coding agent（编程智能体）的独立 Cordis 配置树。已发布的 profile 名称 sdk-minimal 会被拒绝；请使用 dsh --profile sdk。"
kind: "package-bundle"
---

# `@redspark/rsh-sdk-minimal`

[English](README.md) | 中文

## 概述

启动器在启动、导出配置、插件管理和 `--from-default-profile` 上拒绝 profile 名称 `sdk-minimal`。受支持的 SDK 启动是 `dsh --profile sdk`；见[原生配置迁移](../../../../Docs/native-config-migration.zh.md)。本包仍是自定义 legacy profile 可以组合的独立 Cordis 配置树。它只公布按平台选择的持久 shell，把会话持久化为未压缩 JSONL，并从 SDK 初始化请求选择模型。它刻意排除 `dsh-base`、Web、settings、托管凭据、遥测、压缩（compaction）、文件系统工具、workspace 指令、skill（技能）、jobs 与 subagent。其 danger-full-access 策略允许 shell 修改进程可访问的任何路径，因此只能配合隔离 workspace 使用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

不要以 `sdk-minimal` 这个名称启动、导出配置或管理插件。启动器拒绝这些命令，也不会改写已有目录。自定义 legacy profile 仍可以在 `dsh.profile.bundles` 中列出 `@redspark/rsh-sdk-minimal`。组合它时提供显式 `RSH_HOME` 和一次性 workspace。受支持的 SDK 启动是：

```sh
export RSH_HOME=/absolute/path/to/example-dsh-home
dsh --profile sdk
```

`RSH_CONTEXT_WINDOW` 为不在适配器建议目录中的模型设置后备容量。`RSH_SYSTEM_PROMPT` 替换默认 persona。SDK 初始化请求是唯一的模型选择依据，并覆盖环境默认值。

以 `sdk-minimal` 这个名称管理插件会被拒绝。受支持的 SDK profile 使用 `dsh plugin --profile sdk`，或者在组合本包的自定义 legacy profile 上管理插件。有序 `--patch` 文件可以替换本包完整默认配置树中的配置项，或在该配置树上方插入 bundle。组合本包且设置 `patchReload: startup` 的 profile 只在启动时应用这些 patch。

该 profile 只挂载一套持久 shell：Linux 和 macOS 使用 Bash，Windows 使用 PowerShell。两套配置都使用 300 秒超时与一个 agent 自有终端；另一平台的配置项保持禁用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该 bundle 的单个 insert 就是完整应用配置树：SDK stdio 启动与 JSON-RPC 服务、一个由环境配置的 DeepSeek 适配器、显式 agent 核心、本地子进程执行、按平台选择的持久 shell PTY，以及位于 `$RSH_HOME/sessions` 的未压缩 JSONL 持久化。它不继承其他 bundle，因此每个额外配置项都是显式 profile 变更。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 完整独立 profile 配置树及其环境默认值 |
| [`src/index.ts`](src/index.ts) | Bundle 包入口 |
| — | 不发布运行时不变式伴生项；本包只是静态 patch 列表载体，插入的各行分别拥有自己的运行时关系和不变式伴生项。 |
| [`tests/sdk-minimal.spec.ts`](tests/sdk-minimal.spec.ts) | 精确组合、profile 名称与平台选择检查 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Python SDK 示例](../../../../Programs/SDK/python/sdk/examples/README.zh.md)——选择 `dsh --profile sdk`，而不是本包已被拒绝的名称。
- [SDK 应用 bundle](../sdk-app/README.zh.md)——完整与极简 SDK profile 复用的 JSON-RPC 应用层。
- [Base bundle](../base/README.zh.md)——本 profile 刻意省略的完整产品基础。

-----

<a id="model-experience"></a>
## 模型体验

### 极简 coding agent 组合

#### 模型看到的内容

系统提示词取 `RSH_SYSTEM_PROMPT`，未设置时使用 `You are a helpful software engineer assistant.`。对外公布的唯一工具是 Linux/macOS 上 agent 所有的持久 `bash` 或 Windows 上的 `pwsh`；运行时上下文、文件系统工具、workspace 指令、skill、jobs 控制、压缩与 Harness 身份均不存在。

#### Token 影响

一个稳定 persona 加一个工具 schema。工具结果与普通对话历史随会话增长。

#### KV Cache 影响

当 persona、平台、提供方、模型与 bundle patch 栈固定时保持稳定。Profile 变更在下一个进程生效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **已发布名称不再启动** — `dsh --profile sdk-minimal`、`--from-default-profile sdk-minimal` 与 `dsh plugin --profile sdk-minimal` 都会以错误退出。已有目录不会被改写。请使用 `dsh --profile sdk`，或从自定义 legacy profile 名称组合本包。
- **该组合刻意省略共享产品服务** — 需要 settings、托管凭据、策略预设、遥测、Web 工具或完整默认工具清单时，请选择 `dsh --profile sdk`。
- **用户 patch 可以扩展配置树并破坏 stdout** — profile 自定义属于受信任的应用组合；向 stdout 写入普通文本的插件会破坏 JSON-RPC 分帧。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
