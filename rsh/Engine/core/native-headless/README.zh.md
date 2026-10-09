---
description: "面向显式文件系统与持久 Session profile 的原生一次性 headless agent。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-headless

[English](README.md) | 中文

## 概述

`dsh-native-headless` 为原生 `dsh --profile` 组合提供一个应用。它把用户提示词发送给选定模型，执行限定在工作目录内的 UTF-8 文件读写，可选地在 profile 选择的 worker runtime 中运行 TypeScript，将模型可见消息与工具结果写入已发布格式的 Session 日志，并在返回前完成其持有 writer 的结算。原生 profile 还须安装文件系统、观察策略、Session 持久化、模型、模型执行及原生 Agent Provider。

## 目录

- [配置](#configuration)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## 配置

委派调用保留选定沙箱策略，不能通过审批扩张权限。需要审批的请求记录 asked 与 decided 事实，其中策略为 never、结果为 rejected；根请求仍使用选定审批回答者。中断的临时子任务通过既有所有者修复 turn，使已接受事件观察者与持久日志收到相同取消关闭事件。

可持续观察在精确授权工作区内提供不可变部署默认值。模块提供者从持久事实重建子任务路由与组合，不继承激活预算；Program 保留驻留、待处理输入与唯一写入器。

可选的 `agentInstructions` Provider 在每个获准模型请求之前准备工作区指令。应用在分发前将返回的上下文记录为 `user/message`；持久化来源事实控制恢复协调，已接纳的文件系统结果控制嵌套目录发现。

`./native` 入口要求 `cwd` 是已存在目录的绝对路径，`provider`、`model` 与 `systemPrompt` 是非空字符串，`maxSteps` 可选且为正整数（默认 `4`）。未知字段会使 profile 激活失败。应用接受提示词或 `--resume <session-id> [prompt]`；每次调用通过同一个 Agent execution owner 接纳一个根输入。续接时若工作目录或系统提示词已改变，应用会拒绝执行，避免悄悄发送来自另一 profile 的历史。固定工具 schema 提供 `read_file` 与 `write_file`；安装 `codeRuntime` 时会增加 `run_code`，它接受 `{ "program": string }` 并把 runtime 的有界 JSON 结果记录为工具 outcome。程序失败会变为名称为 `NativeCodeRuntimeError`、错误码为 `CODE_RUNTIME_*` 的工具结果。可选 `tools` 和 `promptSections` 服务会添加可撤销 schema 和系统文本；可选 `sandboxPolicy` 会向固定写入提供当前 Session 策略；可选 `approval` 会在 `write_file` 或受保护贡献执行前应用其策略。写入经过文件观察策略，越过 `cwd` 的路径以 `FS_SANDBOX_DENIED` 失败。

可选的 allowedTools 列表会过滤每个请求中的内置工具和注册工具 schema，并拒绝不在该列表中的调用。提示词 section 收到的名称来自同一份已发送 schema 快照；既有 Session writer 会持久化组装后的系统提示词，并在恢复和分叉时校验。

应用在每次模型可见输入、助手响应及工具结果后刷新 Session JSONL 日志。安装 `timeContext` 时，它会在派生每个模型请求前追加返回的带来源时钟消息。安装 `approval` 时，它会在调用应答者前持久追加 `native-approval/asked`，并在执行获准操作前持久追加匹配的 `native-approval/decided`；未中止的非授权结果会变为 `APPROVAL_*` 工具结果错误。取消在决定审计刷新后保留借用 signal 的原始原因；审计或清理失败仍作为错误传播。每个 Session 使用一个由其标识派生的子作用域原生 Agent。Turn 在该 Agent 的显式 initiator boundary 内运行，Program 在已接纳工作排空后释放身份。中断时会记录部分助手输出，并在关闭 turn 前补齐未完成的工具结果。模型 Provider 必须提供原生 `model` 服务及 `dsh-llm` 流协议。

每次 dispatch 前，既有 Session writer 将已准备模型代际声明的容量记录在 `request/context` 中。路由或容量变化会替换已记录上下文；缺少容量会清除旧值。不增加独立目录查询或 Session 格式代际。

[模型执行 Provider](../native-model-execution/README.zh.md)负责组装并记录每个助手流事件。应用继续拥有 turn 和工具执行。

应用使用 `dsh-session-persistence/native` 的 `NativeSessionPersistenceOperations`；JSONL 是一个可替换 Provider。每轮只拥有其选定 Session 句柄，并等待其持久化和关闭。应用不关闭或实例化持久化服务。改变 Provider 类型所有权不会改变模型输入或已记录事件。

已注册工具使用注册表的模型传输选择和精确 Agent 作用域。工具拥有的事件通过同一 Session writer 追加；并发追加回调串行持久化。应用先接受包含呈现元数据的最终结果，再通知结果观察者，然后在下一次模型请求前追加带来源的额外消息。每个工具结果记录后（包括固定工具与失败结果），应用会向注册表的结算策略请求上下文，并把它们追加在工具自身的消息之前。成功的工具结束标记只在当前批次所有调用结算后结束回合。取消会阻止已移除贡献的迟到成功结果被接受。

已校验的 `builtinTools` 布尔值默认为 `true`。设为 `false` 会移除固定文件 schema 和内置 `{program}` 代码工具，并且仅调度注册表贡献。可选 PTC profile 显式选择该值，使注册表拥有的 `run_code` 成为唯一传输工具。Prompt 段在呈现文本进入持久化 system message 前接收精确的请求 Agent scope。

一次性执行清理会在活动 owner 观察者拒绝后仍尝试关闭 writer，同时保留执行与清理失败。Agent 接纳在发布生命周期通知前拥有借用的 preset lease，通知失败或取消会释放 lease。驻留子级将选定 preset 持久化到创建 header，并在模块准备前校验恢复事实。

`sessionExecution` 通过同一个执行器路由子任务 turn 和 continuation。`activeSessions` 发布精确的当前 Agent、Session 和 writer；消费者保留该所有者以维持常驻根，或在空闲维护中追加事实而不启动模型 turn。模型和指令准备等异步操作完成后，Program 执行 admission 提交检查，随后同步移除确切的已选 inbox 输入并追加 step 与模型可见输入事件；仅取消失效输入，其他待处理消息仍留在队列中。恢复和 fork 保留历史 preset 选择；移除 preset 会取消并排空其精确租约。仅当 `AbortError.cause` 与已中止信号的确切 reason 相同时，才将其识别为预期取消；执行及清理失败仍为错误。

Program 从选定的持久化集合列出 continuation 候选。它将路径限定在发起 Session 的工作区，穿过普通 Session 父节点，并在检查 subagent 末端前核验每条直接父子关系及 subagent 委派深度。中间节点无法读取时，该候选会返回诊断，不会隐藏健康的兄弟路径。现有 Agent 注册表提供驻留状态，不加载已关闭的子任务。

`rootExecution` 提供带品牌的不可变路由、维护、执行、[确切根取消](../native-session-execution/README.zh.md#execution-ownership)、结算、已关闭 turn 的 fork 及可选可恢复删除。确切活动 root owner 还提供由 Program 绑定的 turn 中断操作，详见[Session 执行所有权](../native-session-execution/README.zh.md#execution-ownership)。动态 `workspaceRoutes` 必须显式配置正数 `maxRoutes` 和非空绝对路径 `allowedRoots`；选择过程按同一文件系统和沙箱策略验证既有 Workspace 目录。Workspace 记录和全局归档 id 使用共享 v2 存储域。删除拒绝忙碌 writer 和不匹配的路由，不会为删除日志取消任务。应用释放会尝试关闭每个 execution 和保留的 epoch，等待全部结束，再于身份和 preset 清理后聚合失败。

选择 `modelSelection` 后，root step 在构造 header 前捕获持久意图。执行器一起解析实际 Provider 默认值与派发；这些参数同时用于持久化 header 和模型请求。路由变更添加已持久化的模型变更提示；委派调用保留显式配置。

根调用的 `prepareMessage` 优先于 `message`。准备过程在既有执行所有者内运行，位于有效下一模型选择之后、inbox 准入之前。它返回带身份的输入，不暴露 Session 写入者；拒绝或取消不会准入用户输入。

根任务取消时，即使初始轮次失败或等待结算的信号已被取消，也会关闭并等待已有驻留 epoch 清理完成。执行失败与 epoch 清理失败会一并报告，保留原执行错误。

<a id="dev-note"></a>
## 开发备注

不发布 invariant companion：应用没有能够独立核对其自身状态的进程内观测。Session 持久化与文件系统 Provider 保留各自的校验。

向忙碌接收者投递 continuation 输入时，实际 active owner 接入后即可通过其收件箱准入。排队的空闲备用操作和实时收件箱只认领一次消息；选中实时所有者会取消并排空尚未执行的备用操作。准入失败保留原始原因。

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

- 固定文件工具、`run_code` 与已注册工具串行执行。此包不实现 SDK 协议或 Web UI；这些接口由原生 SDK 与 Web 组合提供。
- 原生模型 Provider 与更广泛的能力适配器位于其他包。
- 此组合导入 Cordis-free 的 Session 与持久化 `./native` 入口，且不创建 Cordis Context。相关包为 Cordis 兼容入口保留适配器，并将 Cordis 设为可选 peer dependency。

其他原生 Program 可以复用 resolveNativeHeadlessConfig 与 createNativeHeadlessApplication，而不提供另一个应用启动器。要求 Session 所有权的 Program 显式传入选定的执行与活跃所有权服务。
