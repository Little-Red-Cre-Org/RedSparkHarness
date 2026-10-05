---
description: "面向显式文件系统与持久 Session profile 的原生一次性 headless agent。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-headless

[English](README.md) | 中文

## 概述

`dsh-native-headless` 为原生 `dsh --profile` 组合提供一个应用。它把用户提示词发送给选定模型，执行限定在工作目录内的 UTF-8 文件读写，可选地在 profile 选择的 worker runtime 中运行 TypeScript，将模型可见消息与工具结果写入已发布格式的 Session 日志，并在退出前关闭存储。原生 profile 还须安装文件系统、观察策略、Session 持久化、模型、模型执行及原生 Agent Provider。

## 目录

- [配置](#configuration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

`./native` 入口要求 `cwd` 是已存在目录的绝对路径，`provider`、`model` 与 `systemPrompt` 是非空字符串，`maxSteps` 可选且为正整数（默认 `4`）。未知字段会使 profile 激活失败。应用接受提示词或 `--resume <session-id> [prompt]`；每次调用拥有一个 turn。续接时若工作目录或系统提示词已改变，应用会拒绝执行，避免悄悄发送来自另一 profile 的历史。固定工具 schema 提供 `read_file` 与 `write_file`；安装 `codeRuntime` 时会增加 `run_code`，它接受 `{ "program": string }` 并把 runtime 的有界 JSON 结果记录为工具 outcome。程序失败会变为名称为 `NativeCodeRuntimeError`、错误码为 `CODE_RUNTIME_*` 的工具结果。可选 `tools` 和 `promptSections` 服务会添加可撤销 schema 和系统文本；可选 `sandboxPolicy` 会向固定写入提供当前 Session 策略；可选 `approval` 会在 `write_file` 或受保护贡献执行前应用其策略。写入经过文件观察策略，越过 `cwd` 的路径以 `FS_SANDBOX_DENIED` 失败。

应用在每次模型可见输入、助手响应及工具结果后刷新 Session JSONL 日志。安装 `timeContext` 时，它会在派生每个模型请求前追加返回的带来源时钟消息。安装 `approval` 时，它会在调用应答者前持久追加 `native-approval/asked`，并在执行获准操作前持久追加匹配的 `native-approval/decided`；非授权结果会变为 `APPROVAL_*` 工具结果错误。每个 turn 会注册一个由 Session 标识派生的子作用域原生 Agent，在该 Agent 的显式 initiator boundary 内运行模型和工具工作，并且只在 turn 结束后注销它。中断时会记录部分助手输出，并在关闭 turn 前补齐未完成的工具结果。模型 Provider 必须提供原生 `model` 服务及 `dsh-llm` 流协议。

[模型执行 Provider](../native-model-execution/README.zh.md)负责组装并记录每个助手流事件。应用继续拥有 turn 和工具执行。

应用使用 `dsh-session-persistence/native` 的 `NativeSessionPersistenceOperations`；JSONL 是一个可替换 Provider。每轮只拥有其选定 Session 句柄，并等待其持久化和关闭。应用不关闭或实例化持久化服务。改变 Provider 类型所有权不会改变模型输入或已记录事件。

已注册工具使用注册表的模型传输选择和精确 Agent 作用域。工具拥有的事件通过同一 Session writer 追加；并发追加回调串行持久化。应用先接受包含呈现元数据的最终结果，再通知结果观察者，然后在下一次模型请求前追加带来源的额外消息。成功的工具结束标记只在当前批次所有调用结算后结束回合。取消会阻止已移除贡献的迟到成功结果被接受。

已校验的 `builtinTools` 布尔值默认为 `true`。设为 `false` 会移除固定文件 schema 和内置 `{program}` 代码工具，并且仅调度注册表贡献。可选 PTC profile 显式选择该值，使注册表拥有的 `run_code` 成为唯一传输工具。Prompt 段在呈现文本进入持久化 system message 前接收精确的请求 Agent scope。

<a id="dev-note"></a>
## 开发备注

不发布 invariant companion：应用没有能够独立核对其自身状态的进程内观测。Session 持久化与文件系统 Provider 保留各自的校验。

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

模型在用户消息前收到配置的 `systemPrompt` 及已注册提示词 section。

##### Profile 提示词

```markdown
<configured systemPrompt>
```

#### Token 影响

每个步骤都会发送系统文本，保留的消息会增加后续步骤及续接请求的 token 数。

#### KV Cache 影响

未变化的提示词前缀可复用 Provider 缓存；配置或提示词 section 变化会从首个不同 token 起改变它。

### 工具操作

#### 模型看到什么

模型收到固定 `read_file` 和 `write_file` schema，安装 `codeRuntime` 时还会收到 `run_code`，以及可选 `tools` 注册表按模式选定的 schema。下一次请求前，文件内容、有界代码结果、固定工具错误和已注册工具结果会进入一条工具结果消息。

#### Token 影响

每个步骤都会发送 schema，工具结果会保留在后续步骤和续接请求中。

#### KV Cache 影响

添加、移除或改变操作 schema 会从首个不同 token 起改变请求前缀。

### 时间上下文

#### 模型看到的内容

安装 `timeContext` 且刷新间隔到期时，应用会在发送请求前追加一条带来源的用户消息，包含当前时间、开放轮次的浏览器时区策略和经过时长。

#### Token 影响

该读数会保留在后续步骤及续接请求中，直到压缩将它遮蔽；正数刷新间隔会降低追加新读数的频率。

#### KV Cache 影响

读数追加在现有历史之后，不会改变其前可复用的前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 固定文件工具、`run_code` 和已注册工具串行执行；SDK 协议和 Web UI 仍然缺失。
- 原生模型 Provider 与更广泛的能力适配器位于其他包。
- Session 与持久化包仍携带 Cordis 依赖，但此组合不会创建 Cordis Context。
