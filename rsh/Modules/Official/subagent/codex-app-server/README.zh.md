---
description: "为 detached external subagent 提供 Native Codex app-server 产品模块、协议执行与子进程生命周期 owner。"
kind: "package-reference"
---

# @deepseek-ai/dsh-codex-app-server

[English](README.md) | 中文

## 概述

把一次性文本委派运行在全新的 Codex app-server 线程中，并返回选定的最终答案或安全失败诊断。runner 使用固定版本 @openai/codex@0.162.1，同时保留 Codex 对设置和身份验证的控制权。Native 请求要求 Engine 从精确选中的已准备模型 generation 捕获 Responses transport。已交付的 Providers 尚未提供此能力，因此 admission 会在连接子进程前失败；父级 `maxTokens` 还要求此 generation 对最终投影请求执行输出上限。

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
| Native Codex external driver | Engine 必须从精确选中的已准备模型 generation 捕获 Responses transport。已交付的 Providers 尚未提供此能力，因此 admission 会在连接子进程前失败；父级 `maxTokens` 还要求此 generation 对最终投影请求执行输出上限。 | Engine 捕获逻辑会拒绝缺少 `PreparedAdapterCall.nativeResponses` 的情况；driver 会检查捕获的 route 与输出上限能力。 |
| Native 进程内 spawn 提供方 | 已交付的 Native profile 模板选择进程内 `spawn` 提供方；专用 `native-sdk-dsh-child` 则选择 `dsh-sdk`。本 Codex 驱动不会替代这两条路径。 | Native 子任务执行由 [native-subagent](../../../../Engine/subagent/native-subagent/README.zh.md) 负责。上面的 `native-admission.spec.ts` 用例只覆盖本包连接前的拒绝。 |

<a id="use-this-package"></a>
## 使用本包

在提供 `childConnection` 的 Native Host composition 中挂载此模块。选中的 Native Subagent provider 为实例命名；本模块会把此名称注册为 external child driver。

Host composition 必须以兼容版本提供 `@deepseek-ai/dsh-llm` 和 `@deepseek-ai/dsh-native-subagent` 必需 peer 依赖，并让它们位于同一 Host 依赖图中。

```yaml
- name: '@deepseek-ai/dsh-codex-app-server'
  config:
    name: codex
    permissionMode: never
    env: {}
    limits:
      requestBytes: 1048576
      responseBytes: 4194304
      jsonDepth: 64
      sseEvents: 10000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `name` | `codex` | 非空的 Native external-driver 名称 |
| `model` | 未设置 | 不支持；模型由捕获的 Native route 选择，设置此字段会导致配置拒绝 |
| `permissionMode` | `never` | Native 只接受省略或 `never`；其他值会导致配置拒绝 |
| `env` | `{}` | Native 只接受空映射；隔离 launcher 拥有已清理的子进程环境 |
| `limits` | 必填 | `requestBytes`、`responseBytes`、`jsonDepth` 与 `sseEvents` 的正安全整数上限 |
| `disposeGraceMs` | `3000` | Core 释放受管 child range 时使用的宽限时间 |

Cordis 兼容 runner 只接受文本 prompt block，并启动全新的临时 Codex thread。它使用 Provider 部署配置中的 `config.model`；未设置时沿用 Codex 设置。每个请求都不会提供 model 覆盖值或 `reasoningEffort`。直接调用 Official `startCodexProductRun` API 时可以显式提供这两个可选字段。Native route 从解析后的 Engine request 获取 provider、model 与 reasoning effort。Engine admission 会从匹配的已准备模型 generation 捕获 Responses 投影和转发；父级提供 `maxTokens` 时，捕获的 generation 必须执行硬性输出上限，且最终投影的 `max_output_tokens` 必须不超过该值。Engine 选定 reasoning effort 后，最终投影的 `reasoning.effort` 必须保持该值。缺少 transport 或上限能力时，会在子进程启动前失败。此 Native route 的 Codex permission policy 固定为 `never`。

Codex 设置与凭据继续由产品原生机制管理。app-server 命令从固定 package manifest 解析，不会使用 `PATH` 中的宿主 `codex` 可执行文件。

调用方必须显式选择 Core 子进程环境模式：Cordis bridge 使用 `scrub-overlay`，隔离的 Native launcher 使用 `replace` 和私有环境，并在 Windows 上保留 `SystemRoot`。

<a id="understand-the-implementation"></a>
## 理解实现

`src/native.ts` 验证配置、要求 Core 的 `childConnection` 并注册唯一的 `NativeExternalSubagentDriver`。它声明支持 model 与 reasoning effort route，并声明不支持 persona、工具筛选、结构化输出和 approval relay。`src/run.ts` 拥有产品运行与协议决策；`src/wire.ts` 使用 Core 共享 transport 实现 JSON-RPC 分帧。

兼容桥接接受的请求会启动受管 child range、初始化 app-server、创建临时 thread、提交一个 turn，并根据该 thread 的终态通知结算。Native run 在进入此产品进程路径前要求已捕获的 Engine Responses transport；目前没有已交付的 Provider 提供所需的 prepared-generation 能力，因此 Native admission 会在连接前失败。进程失败、取消和释放都由同一个 Core child connection 管理；卸载模块时会 drain 正在运行的 run。

Native product runner 根据捕获的 Engine 直接 schema 构建 Codex 与 Responses function 定义。它只在 Engine 记录完整模型响应后才向 Codex 返回响应，并将每个 app-server 调用的 thread、turn、call ID、名称、namespace 和 JSON 参数与一次性 grant 精确匹配，再通过捕获的 Engine operation 执行。工具结果会返回文本和已验证图像的 data URL；result 自带上下文与已接受的 settlement context 只追加一次到下一条持久化请求。结论型结果会关闭后续模型请求，并在所有已接受的工具回复写出后中断精确 Codex turn；turn 报告 `interrupted` 时仍保留并返回 Engine 原始结果。若 Codex 在报告该中断前再次请求模型，gateway 会返回本地 403，并保留成功结论，不会将其改记为致命模型错误。

隔离 Native product runner 要求提供捕获的 `projectRequest` 与 `forward` 回调，以应用所选 provider 的策略并使用其凭据。它记录并转发同一份投影后的请求体；本包不解析 provider 凭据，也不实现这些回调。Transport 必须来自 Engine 选中的 prepared model generation。只有该 generation 执行上限且最终投影请求包含不超过父级上限的有效 `max_output_tokens` 时，才接受父级输出 token 上限。Engine 会传播绑定到外层 operation 准确 prepared model handle 的进程内 generation 能力；同 route 嵌套请求会从该 generation 捕获独立 transport，不会重新查找后续 adapter。这不会启用 provider override，Native Codex driver 仍会拒绝该选项。Native 执行仍需要真实捕获的 Provider transport 和 SDK 事件投影；已交付的 Provider 尚未提供该 transport，因此 admission 仍会在连接子进程前失败。

释放流程会先排空已接受的 Engine 执行与 Core 管理的 child range，再关闭本地 gateway 并删除私有 Codex home。对于 Node 定义的可重试文件删除错误，它会使用同一个已解析的 `disposeGraceMs` 延迟后重试一次；删除持续失败时仍会拒绝释放操作。

本包不发布 runtime invariant companion，因为没有可由独立 package-owned 观察值构成并发生漂移的关系；Core 拥有 child range，Official runner 拥有 app-server 生命周期。

协议遵循稳定上游 [`ThreadStartParams` schema](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/json/v2/ThreadStartParams.json) 与 [`TurnStartParams` schema](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/schema/json/v2/TurnStartParams.json)。后者将 `effort`、`parentTurnId` 和 `rootTurnId` 定义为可选字段。此 detached task 没有父级或根 Codex turn 标识，因此这两个 ancestry 字段保持未设置；adapter 会从 `turn/start` 绑定当前 turn，用于校验动态调用和结论。RSH Session ID 不是 Codex turn ID。

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

- **Native product admission** — 隔离的 product runner 会执行已捕获的工具授权，但已交付的模型 Providers 尚未公开 prepared-generation Responses transport。请求执行前仍需 Provider transport 与 SDK 集成；Native 配置不能选择其他模型、注入子进程环境变量或放宽固定权限策略。
- **文本任务输入**——初始任务只接受文本。已接受的 Engine 工具结果可以包含已验证图像，捕获的图像服务会先解析图像，gateway 再生成 data URL。
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
