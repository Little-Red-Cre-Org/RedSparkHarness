---
description: "面向用户与维护者的一次性 Claude Code subagent 提供方，用于选择产品后端、安装 Profile bundle 或配置无人值守的 Claude Code 委派。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-claude-code

[English](README.md) | 中文

## 概述

为保留的 Cordis 兼容入口安装此 Profile Bundle；若要把 Claude Code 作为受限的外部 subagent driver，则组合其 Native 入口。每次运行接受一个自包含文本任务，并只返回最终文本或安全失败；产品推理、工具通信、stderr、用量和工作区差异不会进入父 Session。兼容入口使用 Claude 原生设置和配置的权限模式。Native 运行要求显式 Claude 模型和由 Host 凭据服务解析的凭据，并将 `Read` 限定到父工作区。平台锁定的运行时按需启动，且绝不回退到宿主 `claude` 可执行文件。

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

当委派应以父级工作区中的真实 Claude Code 会话运行时，挂载本提供方。常用路径是显式的：把 Bundle 安装进 Profile，可选地配置提供方行，并通过委派工具行把它暴露给模型。

### 安装 Bundle

把包安装进目标 Profile，然后重启该 Profile。安装会把锁定的 Agent SDK 与一个兼容的平台 CLI 载荷带入 Profile；声明的 patch 层只注册休眠的提供方，不启动任何 Claude 进程。

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-subagent-claude-code
dsh plugin --profile <name> remove @deepseek-ai/dsh-subagent-claude-code
dsh --profile <name>
```

移除包后，下一次 Profile 启动会撤回提供方及其私有运行时闭包。安装决定 Host 可用性，而不是模型权限：模型只能通过你组合的委派工具行触达提供方。

### 配置

以下字段只配置保留的 Cordis 兼容入口；Native 入口使用单独且显式的配置。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `claude-code` | `ctx.subagents` 上的非空注册名称；每个已挂载实例都需要唯一值 |
| `model` | Claude 原生设置 | 为本提供方实例的每次运行固定的可选非空模型名称；省略时不发送 SDK 覆盖 |
| `env` | `{}` | 叠加在已清理凭据的父环境之上的显式 SDK/CLI 环境 |
| `permissionMode` | `dontAsk` | 为本提供方实例的每次运行固定的原生非交互权限策略 |
| `disposeGraceMs` | `3000` | 共享 managed-range owner 各终止层级之间的宽限 |

| `permissionMode` 值 | 原生行为 |
|---|---|
| `dontAsk` | 不弹出提示，直接拒绝尚未获授权的操作 |
| `acceptEdits` | 接受文件编辑；其余权限提示由无人值守回调拒绝 |
| `auto` | 由 Claude Code 原生分类器允许或拒绝权限请求 |
| `plan` | 使用原生规划模式，拒绝执行审批，并把完整计划作为最终答案返回 |
| `bypassPermissions` | 显式设置 SDK 的危险确认并跳过权限检查 |

生成的[配置目录](../../../../Docs/config-catalog.zh.md#deepseek-aidsh-subagent-claude-code)记录保留的 Cordis 入口。其提供方名称、可选模型、环境和权限模式不配置 Native 入口。兼容入口保留既有 Claude 行为：配置模型会原样传给每次 query，凭证类环境变量会先从父环境移除再叠加显式 `env`，SDK 会相对于父 Session cwd 读取宿主用户、项目和本地设置。

### Native 外部 driver

`./native` 入口接受 `name`（默认 `claude-code`），要求显式产品 `model`，并接受 `apiKeyEnv`（默认 `ANTHROPIC_API_KEY`）以从 Host 凭据服务解析凭据。可选的 `baseUrl` 指定 HTTP(S) Anthropic endpoint，`disposeGraceMs` 默认 `3000`。Claude Code 拥有模型协议；Native 只返回最终文本，并且只有父级授予内置 `read_file` 时才启用 Claude `Read`。提供方固定使用 `dontAsk`，把父级 `maxSteps` 映射到 SDK `maxTurns`，并在启动进程前拒绝 `maxTokens`、路由覆盖、persona、工具筛选、输出 schema 与父级审批。私有 `CLAUDE_CONFIG_DIR` 仅包含生成的用户设置；宿主管理设置仍可能生效，因此这些设置不是读取授权来源。`PreToolUse` hook 会解析每个路径，并拒绝读取规范化后的父工作区之外的文件，包括 SDK 设置扩大可读目录时。子进程遵循所选 backend 报告的执行等级；Windows ACL 与较旧内核的 Landlock 可能报告 `partial`，因此本入口不宣称完整操作系统隔离。若所选 backend 无法应用父沙箱策略，提供方会在启动前失败。

### 暴露工具

每个委派工具行指名一个提供方，并需要独立的 `toolName`，因此模型看到的是静态工具，而不是动态提供方选择器。完整 Agent Preset 携带对应的默认工具行并设置 `disabled: true`；复制一个 preset 后删除该字段，即可只向由该副本组装的 agent（智能体）暴露 `subagent_claude_code`。

```yaml
- id: jobs
  name: '@deepseek-ai/dsh-jobs-local'
- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'
- id: tool-subagent-claude
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: claude-code
    toolName: subagent_claude_code
    backgroundMode: one-shot
    maxDepth: provider-managed
```

`one-shot` 策略会让省略 `run_in_background` 或传入 `false` 的调用继续在前台等待，而显式传入 `true` 会返回由父 agent 拥有的 job id，供 `job_output` 或 `job_kill` 使用；base host（基础宿主）与完整 preset 已提供通用作业注册表和控制工具。

### 你会得到什么

前台调用会把严格的最终 Claude Code 答案交给模型；运行失败时则返回带停止原因与可选安全诊断的错误。后台调用先返回 job id；随后通用作业控制面会送达完成通知，并通过 `job_output` 公开同一最终答案或失败状态。Claude Code 的推理、工具活动、中间消息、stderr 与工作区差异绝不会进入父级会话。

### 失败与恢复

省略 optional dependencies、当前平台不受支持或所选载荷缺失的安装会让提供方保持休眠，并在第一次委派时于 SDK 启动边界报告安全的 `query-start` / `unknown` 失败事实；不存在宿主 CLI 回退。原始产品错误只保留在内部 cause 链与提供方 Host 日志中。被取消的运行以 `aborted` 结算。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方如何驱动真实 Claude Code CLI，以及可观察行为从何而来；完整约定见[使用本包](#use-this-package)。

### 设计理念

- **每次运行一个全新 query。** 每次运行都拥有独立的 SDK query、取消控制器、CLI 进程与不持久化的产品会话；没有续接、恢复或池化。
- **两种入口保留各自的设置来源。** Cordis 兼容入口读取宿主用户、项目和本地设置；Native 入口要求显式模型、使用私有用户设置，并通过 `PreToolUse` hook 限制父工作区读取。宿主管理设置仍保持启用。
- **刻意无人值守。** `AskUserQuestion` 被禁用，除 bypass 模式外权限提示都会被拒绝，因此 query 绝不会等待用户界面。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提供方注册 |
| [`src/run.ts`](src/run.ts) | Cordis 适配器：把旧入口接到共享产品 controller |
| [`src/controller.ts`](src/controller.ts) | 共享 SDK query、进程生命周期与结果接受 |
| [`src/native.ts`](src/native.ts) | 受限 Native external-subagent driver |
| [`src/process.ts`](src/process.ts) | dispose（资源释放）时的 managed-range 逐级终止 |
| [`cordis.patch.yml`](cordis.patch.yml) | 注册休眠提供方的 Profile patch 层 |

### 运行流程

启动只接受非空文本任务，并根据父请求确定子级 cwd。两个入口都通过共享 controller 调用官方 SDK `query()`；只有 SDK 已提供由子进程服务管理的活动 CLI 句柄后才会发布运行，并且仅在收到成功终态 `result` 且消息迭代器正常结束后才完成。Cordis 适配器保留既有 `SubagentRun` 结果和诊断处理；Native 适配器使用父级准入、沙箱、工作区、工具与生命周期权威，并只返回 Claude 最终文本。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从本提供方逐步进入它接入的 seam 与兄弟产品提供方。

- [Subagent 子系统](../../../../Docs/subsystems/subagent.zh.md)——服务约定、提供方约定与终态结果语义。
- [dsh-subagent seam](../../../../Engine/subagent/subagent/README.zh.md)——本提供方注册于其上的注册表与启动 API。
- [Codex 兼容桥接包](../../../../Compatibility/DSH/bridge/subagent-codex/README.zh.md)——Codex 产品的旧版 Cordis 适配器。
- [Official Codex app-server 产品包](../codex-app-server/README.zh.md)——native app-server 协议与外部 child driver 的 owner。
- [Claude Code 与 Codex 后端](../../../../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.zh.md)——产品提供方的设计记录。
- [生成配置目录](../../../../Docs/config-catalog.zh.md#deepseek-aidsh-subagent-claude-code)——每个受支持配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

### 子级请求

#### 模型看到什么

Claude Code 子级会在全新 SDK query 中接收独立文本任务。兼容入口配置可选模型、环境和非交互权限模式；省略模型时由 Claude 宿主设置选择。Native 入口要求自己的显式模型和 Host 解析的凭据；只有父级授予 `read_file` 时才允许在父工作区内使用 `Read`。两个入口都使用 Bundle 锁定的 SDK 平台载荷中的可执行文件。

#### Token 影响

子级需为独立的 Claude Code 上下文和 query 承担 token 成本。子级 token 不会进入父级上下文。

#### KV Cache 影响

与父级请求缓存相互独立。能否复用取决于 Claude Code 自身的模型、指令、可用工具、原生设置和全新 query。

### 父级调度与结果（间接）

#### 模型看到什么

通过 `dsh-tool-subagent`，前台调用会让父级模型看到符合严格成功条件的 Claude Code 最终答案；若结果未完成，错误中会包含终止原因和可选的安全诊断。该诊断可以区分粗粒度行动类别、生命周期阶段和已观测的进程结果，而不复制原始产品文本或版本专属 subtype 名称。后台调用会先返回 job id；随后通用作业控制面会送达完成通知，通过 `job_output` 公开同一最终答案或失败状态详情，并允许 `job_kill` 请求取消。Claude Code 的推理、工具活动、中间消息、stderr、工作区差异、用量信息、产品标识符、工具输入和原始协议载荷均不会复制到父会话。

#### Token 影响

前台输入会增加工具结果中保留的最终答案或错误内容。后台输入还会包含启动确认、完成通知，以及 `job_output`、`job_kill` 或后续状态结果；子任务 token 仍不会进入父级上下文。本提供方自身不添加父级工具 schema。

#### KV Cache 影响

仅追加：前台会在可复用的父请求前缀后增加一个结果，后台则会继续追加 Job 启动确认、通知以及后续控制或收集结果。后台调度可能增加一个由通知唤醒的轮次，但这些消息都不会改写更早的前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本提供方何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是通用 Claude Code 对比或任务积压。

- **每次运行均新建一个 query 和一个进程**——不支持续接、恢复、池化、进度流或产品会话持久化。
- **静态选择实例**——Profile 配置项固定提供方名称、可选模型与工具绑定；调用无法动态选择或修改提供方与模型，而且每个公开工具都需要唯一的 `toolName`。
- **兼容入口设置由宿主掌控**——省略兼容配置中的 `model` 时由 Claude 项目与用户设置选择模型。Native 要求显式模型并使用私有用户配置；宿主管理设置仍保持启用，而 `PreToolUse` hook 会限制父工作区的 `Read`。
- **身份验证与账户状态仍由原生机制管理**——Bundle 会提供 CLI，但不会创建账户、登录或改写 Claude 设置；配置与身份验证失败会公开其生命周期阶段与安全的 `unknown` 回退，而不会增加单独的公开分类。
- **委派时必须存在 SDK 平台载荷**——省略 optional dependencies 的安装、不受支持的平台以及缺失或损坏的载荷都会在第一次 query 时失败；不会回退到宿主 CLI。
- **Native 没有人工交互路径**——Native 固定使用 `dontAsk`，禁用 `AskUserQuestion`、MCP server 和插件，并拒绝权限请求而不暂停等待；兼容入口保留配置的 `permissionMode`。
- **assistant 载荷仅包含最终文本**——父工具结果可单独包含安全失败诊断，后台状态由共享 Job 控制负责；推理、中间消息、工具通信、用量信息、stderr 和工作区差异仍只保留在产品内部。
- **Native 能力受限**——Native 使用 Claude 模型协议；只有父级授予 `read_file` 时，产品 `Read` 工具才可用。提供方会拒绝路由覆盖、输出 schema、子任务 persona、工具筛选、父级审批和 `maxTokens`，因为无法强制执行这些字段。
- **没有按实际经过时间触发的超时或副作用回滚**——长时间运行的工作由调用方取消，且取消前已更改的文件或外部系统不会恢复原状。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为与限制以上文和包代码为准。

- **载荷体积披露**——当前 darwin-arm64 平台载荷压缩后约 92 MB、解包后约 325 MB；这些是披露数字，不是安装阈值。
- **版本锁定的协议**——运行时依赖锁定为 Agent SDK 0.3.263；升级会锁定新的 SDK 版本，并需要重新运行无密钥真实产品与 loader 组合证据。

</details>

**运行时不变式：** 不发布伴生入口。生命周期配对属于共享 subagent 服务，受管范围的所有权属于 subprocess 服务。
