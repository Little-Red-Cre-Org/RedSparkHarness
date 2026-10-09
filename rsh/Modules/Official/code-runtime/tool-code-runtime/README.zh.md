---
description: "通过 profile 选择的代码运行时，将有界 TypeScript 或 Python 执行作为可撤销的原生工具公开。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-code-runtime

[English](README.md) | 中文

## 概述

`dsh-tool-code-runtime` 向原生 profile 的工具注册表添加 `run_code`。所选代码运行时执行 TypeScript 或 Python 程序，并返回有界日志、JSON 值或程序失败。移除本模块会停止代码工具接收新调用，并取消及排空在途调用。应用记录一个普通工具结果；只安装代码运行时不会公开该工具。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

`./native` 入口接受 `maxParallelSubCalls`（默认 `10`，正安全整数）及 `sdkPrompt`（默认 `false`，布尔值）。它要求 `tools`、`codeRuntime` 和 `fs`，可选读取 `sandboxPolicy` 及 `promptSections`。启用 `sdkPrompt` 必须选择提示词 Provider，并在 Consumer 作用域安装可撤销的 `tools:sdk` 段。profile 独立选择这些 Provider。所选运行时语言决定代码 schema 和 SDK 声明；Python 说明涵盖普通 JSON 参数、静态 TypedDict 声明、`asyncio.gather` 与 `print`，不支持的语言会拒绝安装。重复名称会失败，作用域可见性、参数校验、取消及释放均使用普通工具注册表。

存在文件策略时必须使用执行沙箱约束的代码运行时，除非当前 Session 解析出的模式为 `danger-full-access`。`process-sandbox` 运行时要求显式策略，并在执行前从同一个 Session 解析有效工作区；Session 没有匹配工作区时会在进入 Provider 前拒绝。当前 Session 受限时会拒绝其他运行时。本模块不会替换 Provider 或扩大其资源限制与执行隔离策略。

此工具注册为值贡献。注册表先校验传输结果，再呈现其文本，并为程序消费者保留独立的标准结果；格式错误的运行时结果以 INVALID_TOOL_OUTPUT 拒绝。每次运行前，Consumer 查询 Agent 可见的标准工具 schema，将其函数安装到 `tools`，排除 `run_code`。每个 binding 使用原生有序调度，返回工具标准值。工具失败在程序中以带有 `toolName` 的 `ToolCallError` 拒绝。可见的仅呈现贡献会在进入运行时前使 SDK 查询失败。Consumer 在每种 Provider 结果后关闭并排空调度，包括异常；Session 写入失败会使外层调用拒绝。

组合会在外层工具结果后转发成功嵌套调用的图片呈现及显式有来源上下文。这些输入不进入标准程序值。Provider 报告的程序错误保留已积累上下文，但抑制终结标记；成功的外层结果在调度排空后转发嵌套终结意图。

<a id="model-experience"></a>
## 模型体验

### run_code

#### 模型看到什么

工具执行必填 `code` 提供的异步 TypeScript 或 Python 函数体，并要求 `description` 概述其操作。说明必须含非空白文本；未声明字段（包括 `program`）会在进入运行时前以 `INVALID_ARGS` 拒绝。Provider 通过其内部 `program` 请求接收 `code`。标准传输输出包含有序 `logs` 及可选 `result`，后者由 Provider 完成值映射而来。模型文本连接日志与完成值：字符串保留原文，其他 JSON 根值使用共享格式化呈现器，空输出则明确说明。失败包含类别、消息及捕获日志；标准输出在 `error` 中保留诊断。程序失败保留 `NativeCodeRuntimeError` 元数据和 `CODE_RUNTIME_*` 错误码。消费应用在权威 Session 中记录两个参数、所选 schema 和结果。

#### Token 影响

schema 带来固定请求开销。启用 `sdkPrompt` 后，应用在进入模型前将使用说明及可见参数／结果声明记录到 system message。声明排除 `run_code`，遵循消费 Agent 的限制，并拒绝仅呈现工具。程序源码和有界结果文本保留在 Session 历史中，并可能进入后续请求。

#### KV Cache 影响

安装或移除贡献会改变所选工具 schema 前缀。注册表的 `native` 模式隐藏该传输并省略其 SDK 段；`ptc` 仅公开传输，并在业务声明前加入只使用 run_code 的规则；`both` 保留直接业务 schema 和 SDK 段。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此 Consumer 接受 TypeScript 和 Python Provider，在激活时拒绝其他语言。SDK 说明描述 `code`、`description` 及标准 JSON 结果；默认省略此段，供自行拥有使用说明的组合选择。Provider 抛错或调度持久化失败会直接拒绝，不生成组合结果。
- 程序返回、超时和模块移除会在外层调用完成前排空已准入的 binding 主体及其 settle 记录。取消不会撤销已完成的外部副作用。Provider 仍负责停止执行载体。

不发布 invariant companion，因为贡献没有独立于应用 Session 结果的持久化观测。

<a id="dev-note"></a>
### 开发备注

无。
