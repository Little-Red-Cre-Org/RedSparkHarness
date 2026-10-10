---
description: "为 detached external subagent 提供 Native Codex app-server 产品模块、协议执行与子进程生命周期 owner。"
kind: "package-reference"
---

# @deepseek-ai/dsh-codex-app-server

[English](README.md) | 中文

## 概述

把一次性文本委派运行在全新的 Codex app-server 线程中，并返回选定的最终答案或安全失败诊断。runner 使用固定版本 @openai/codex@0.162.1，同时保留 Codex 对设置和身份验证的控制权。由于此适配器尚未执行父级工具授权或继承的正数 maxSteps 上限，Native 请求会在产品进程启动前停止。

## 目录

- [当前支持矩阵](#current-support-matrix)
- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="current-support-matrix"></a>
## 当前支持矩阵

| 路径 | 当前状态 | 证据边界 |
|---|---|---|
| DSH Cordis Codex 兼容 runner | 通过 Official 产品 runner 执行的一次性文本路径 | 修复 sandboxMode 传递并断言生成的 config.toml 后，只重跑了两个受影响的真实产品权限用例：显式 bypass marker 写入通过；never 加配置 workspace-write 的用例确认 config.toml 包含 workspace-write，但 nested product tool 返回 blocked by policy 后跳过，写入和继承仍未验证。此前三文件集合的 64 通过/1 跳过早于 fixture 修复；其继承归因已被取代。 |
| Native Codex external driver | 没有 Native 请求可以执行；此适配器尚未执行精确的父级 authority 和正数 `maxSteps` 上限，因此每个请求都会在 `childConnection.connect()` 前被拒绝。部署级 `permissionMode`（包括 full access）不能覆盖该拒绝。 | 现有 `native-admission.spec.ts` 回归用例确认在配置 bypass 权限时仍会于连接前拒绝；这只证明拒绝契约。 |
| Native 进程内 spawn 提供方 | 已交付的 Native profile 模板选择进程内 `spawn` 提供方；专用 `native-sdk-dsh-child` 则选择 `dsh-sdk`。本 Codex 驱动不会替代这两条路径。 | Native 子任务执行由 [native-subagent](../../../../Engine/subagent/native-subagent/README.zh.md) 负责。上面的 `native-admission.spec.ts` 用例只覆盖本包连接前的拒绝。 |

<a id="use-this-package"></a>
## 使用本包

在提供 `childConnection` 的 Native Host composition 中挂载此模块。选中的 Native Subagent provider 为实例命名；本模块会把此名称注册为 external child driver。

```yaml
- name: '@deepseek-ai/dsh-codex-app-server'
  config:
    name: codex
    permissionMode: never
    env: {}
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `name` | `codex` | 非空的 Native external-driver 名称 |
| `model` | 未设置（若使用则沿用 Codex 设置） | Native driver 的可选默认模型；每个 Native 请求都会在产品启动前拒绝，因此当前不会使用该值 |
| `permissionMode` | `never` | 旧版兼容运行器的审批与沙箱策略；Native 请求当前会在启动线程前停止 |
| `env` | `{}` | 叠加在 Core 已清理凭据的父环境之上的显式子进程环境 |
| `disposeGraceMs` | `3000` | Core 释放受管 child range 时使用的宽限时间 |

Cordis 兼容 runner 只接受文本 prompt block，并启动全新的临时 Codex thread。它使用 Provider 部署配置中的 `config.model`；未设置时沿用 Codex 设置。每个请求都不会提供 model 覆盖值或 `reasoningEffort`。直接调用 Official `startCodexProductRun` API 时可以显式提供这两个可选字段。Native driver 没有可执行请求，并会在产品启动前拒绝，因此它声明的 route-model metadata 不能证明运行中请求的模型优先级。权限模式映射为 `thread/start` 字段：`never` 设置 `approvalPolicy: never`；`approve-for-me` 设置 `approvalPolicy: on-request`、`approvalsReviewer: auto_review` 和 `sandbox: workspace-write`；`dangerously-bypass-approvals-and-sandbox` 设置 `approvalPolicy: never` 和 `sandbox: danger-full-access`。Native driver 会在委派请求使用这些部署设置前拒绝请求。

Codex 设置与凭据继续由产品原生机制管理。app-server 命令从固定 package manifest 解析，不会使用 `PATH` 中的宿主 `codex` 可执行文件。

<a id="understand-the-implementation"></a>
## 理解实现

`src/native.ts` 验证配置、要求 Core 的 `childConnection` 并注册唯一的 `NativeExternalSubagentDriver`。它声明支持 model 与 reasoning effort route，并声明不支持 persona、工具筛选、结构化输出和 approval relay。`src/run.ts` 拥有产品运行与协议决策；`src/wire.ts` 使用 Core 共享 transport 实现 JSON-RPC 分帧。

兼容桥接接受的请求会启动受管 child range、初始化 app-server、创建临时 thread、提交一个 turn，并根据该 thread 的终态通知结算。Native driver 会在此产品进程路径之前拒绝请求，因为固定产品无法执行父级 authority 与执行上限。进程失败、取消和释放都由同一个 Core child connection 管理；卸载模块时会 drain 正在运行的 child。

本包不发布 runtime invariant companion，因为没有可由独立 package-owned 观察值构成并发生漂移的关系；Core 拥有 child range，Official runner 拥有 app-server 生命周期。

协议遵循稳定上游 [`ThreadStartParams` schema](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json) 与 [`TurnStartParams` schema](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/json/v2/TurnStartParams.json)。后者将 `effort`、`parentTurnId` 和 `rootTurnId` 定义为可选字段。此适配器没有 Codex turn ID，因此这两个 ancestry 字段保持未设置；RSH Session ID 不是 Codex turn ID。这些字段不执行 Native 所需的父级工具授权或执行上限。

<a id="further-exploration"></a>
## 进一步探索

- [Codex 兼容桥接包](../../../../Compatibility/DSH/bridge/subagent-codex/README.zh.md)——基于本产品 API 的旧版 Cordis 适配器。
- [Subagent 子系统](../../../../Docs/subsystems/subagent.zh.md)——共享委派语义与 Native 所有权。
- [Native subagent driver 契约](../../../../Engine/subagent/native-subagent/README.zh.md)——request、capability、result 与生命周期契约。

<a id="model-experience"></a>
## 模型体验

### Detached Codex child 请求

#### 模型看到的内容

Codex app-server 会把请求中的文本块作为一个任务提交到全新的临时线程。兼容 runner 使用 Provider 实例配置的 model；未配置时沿用 Codex 设置。请求不能提供 model 或 `reasoningEffort`，但直接调用 Official API 时可以显式提供这两个字段。父会话历史不会被传递。

#### Token 影响

Codex 会为提交的任务消耗独立上下文和轮次。子任务 token 由产品提供方统计，不会通过本模块进入父模型上下文。

#### KV Cache 影响

与父模型请求相互独立。复用取决于 Codex 自己的模型、指令、配置与临时线程请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Native authority 与执行上限** — 此适配器尚未执行 Native 工具授权或 `maxSteps`/`maxTokens`。在能执行这些父级约束前，Native driver 会在连接前拒绝所有外部请求；部署权限配置不能替代这些约束。
- **仅接受文本输入**——非文本 block 会在进程启动前被拒绝。
- **不继承会话**——每次运行都会创建临时线程，没有恢复或池化路径。
- **不支持 Native 可选 request 能力**——persona、工具筛选、结构化输出和父级审批 relay 均不支持并会被拒绝。
- **没有人工审批通道**——配置的无人值守策略会直接处理已知 app-server 请求；未知请求会默认拒绝并使运行失败。
- **协议按版本锁定**——升级 Codex 前须刷新官方 schema 证据，并运行协议与真实产品 gate。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
