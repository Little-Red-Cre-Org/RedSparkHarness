---
description: "具有确切所有权及贡献移除等待语义的原生活动 Session 执行路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-session-execution

[English](README.md) | 中文


## 概述

`dsh-native-session-execution` 发布 `sessionExecution` 与 `activeSessions` Definition 及 Provider。Program 注册已有的活动 Session 执行器；委派模块读取其已解析配置，并通过同一所有者请求新的子任务 turn。注册表不创建 Agent、turn 循环、Session 或 writer。

## 目录

- [配置](#configuration)
- [执行所有权](#execution-ownership)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

NativeSessionConfiguration 可显式选择 builtinTools。委派将解析后的选择传递给 Program 执行器；省略时保留该 Program 解析后的选择。受限子组合必须禁用内置能力，并在首次请求前安装注册工具限制。

`./native` 入口要求 `agents`、提供 `sessionExecution` 与 `activeSessions`，并接收空配置。未知字段使激活失败。Profile 显式选择此 Provider；本次变更不修改应用默认组合。

<a id="execution-ownership"></a>
## 执行所有权

`owners()` 返回包含精确现役可写所有者的独立数组。只读观察者先订阅再枚举，并按所有者身份去重，使晚于 Program 启动的 Provider 也能观察已有写入器而无需接管它。已释放的所有者及被替换的 Agent 对象不会出现在结果中。

./root-route 导出拥有共享 NativeRootRouteId 品牌，不导入执行服务。Host 和 Client 使用明确编译面：Client 面仅提供纯路由标识，活跃 Session 和根执行操作属于 Host。工作区身份来自与框架无关的 Engine workspace-definition 包。

`NativeActiveSessionOwner.appendBatch` 通过 Program 唯一保留的 writer 接收关联事实。被拒绝的批次不会跟踪任何事件；已接收事件保持序号顺序，并由 `flush()` 通过既有持久化屏障写入。

仅供 Host 使用的 `./read-history` 工具通过选定的精确存活所有者或既有持久化 reader 读取，不激活 Agent。明确的历史上限额外请求一个事件，以检测超限并拒绝截断。读取后重新检查存活所有权；等待冷 reader 关闭，清理失败保留原读取失败并报告给调用请求的所有者。

`NativeProgramInteractionOwner` 描述 Program 选定的存活请求者及显示根。Program 从实际执行入口和委派关系派生这一只读归属，不依赖持久 Session parent header。交互 Consumer 回答前必须验证确切存活的 Agent 和 Session；显示根不会替代请求 Session 或其 writer。

Host 的 `rootExecution.cancel(owner)` 关闭确切附着的根 Agent epoch，包括未保留驻留的普通轮次。它拒绝外来或已释放的所有者，并等待执行、保留工作、writer 与注册清理。清理失败保留错误及已关闭的执行条目，防止在资源释放状态不明时建立替代执行。取消成功后，后续恢复通过新的 Agent epoch 继续。

委派可提供 `initialize(append)`，在首个 turn 内记录子级自有事实，并通过 `onReady(agent)` 在这些事实持久化后接收已注册子级。执行器在首次模型请求前调用两者。初始化、持久化或交付失败会在自有清理结束后拒绝，模块不会获得 writer 的直接访问权。

Program 使用确切的注册 Agent、匹配的活动 Session、已解析的工作区／模型／提示词／预算及已有子任务执行操作调用 `register()`。每个 Agent 仅接纳一个活动贡献，包括释放等待期间。返回的释放函数关闭 turn 接纳、取消 turn 持有的委派并等待执行器结算。它不关闭 Program 的 writer，也不释放其 Agent。

`configuration()` 与 `delegate()` 要求确切且可用的 Agent 和 Session 对象，以及该 Agent 的当前发起归属。配置是独立且不可变的快照。委派保留选定执行器的结果或错误。贡献释放等待 turn 持有的子操作退出；Agent 和 Provider 释放则取消并等待两种生命周期的操作；执行器仍负责关闭子任务 writer 和释放 Agent。所有者不能在子操作内部等待自身释放。

[原生 turn 执行器](../native-headless/README.zh.md) 使用已解析配置注册每个活动 Session，并在关闭父 writer 前移除贡献。各 Program 保留分别解析的 Session 配置，不替换为全局路由。替换 Provider 实现相同 Definition，无需替换 Agent 注册表或 Session 存储。

`continuations.catalog()` 从选定 Program 提供只读候选路径。`continuations.inspect()` 检查父子关系并要求末端为 subagent；消费者解释描述符事件。这两个操作都不创建 Agent 或写入器。

接纳时 `lifetime` 解析为 `turn`，除非调用方显式选择 `agent`。Agent 持有的委派会跨普通贡献移除继续执行，下一父级 turn 可注册新的确切 Session。启动仍要求当前活动父级，保留的后台任务不能通过过期 Session 接纳调用。调用方传入后台所有者的取消信号；当最后一个后台操作结束时，结算会移除其 Agent 清理贡献。

委派可通过 `prepare` 在执行器渲染系统文本或选择工具声明前安装子级作用域贡献。回调接收确切的已注册子级与绑定的资源所有者。执行器等待准备、回滚和资源释放后才完成委派；准备与清理失败保留独立原因。`onReady` 仍是在初始事实持久化后的交付回调，不是配置安装窗口。

`activeSessions` 服务在模型调用发起归属之外提供确切的 Program 所有 Agent 与 Session 访问。注册会等待未来 attach 观察者后才允许初始模型接纳。释放会关闭查询接纳、等待已接纳 attach 回调，并在 Program writer 清理前执行 detach 清理；移除观察者也会等待已接纳回调。Attach 失败通过 detach 清理回滚。复制的 Agent 与复制的 Session 不能选择所有者。

活动所有者通过唯一 writer 暴露已校验历史、追踪 append/flush、独立的持久收件箱候选与后端已接纳事件观察。其 invocation 来自当前 Program 入口（`root` 或 `delegated`），独立于历史 Session 谱系。有序异步 step hook 通过 `next()` 委派，只能选择未修改的已捕获候选。Hook 可注册一个同步提交检查，由 Program 在请求准备后执行；检查只能取消该次 admission 所选候选的 id，并且不能返回 Promise。

驻留保留是进程本地的 Program 所有权。Consumer 可跨空闲 turn 保留根 writer；释放确切的 lease 允许自然关闭。取消与卸载会覆盖保留并等待已接纳工作停稳。Consumer 仅在 `writerAvailable` 且确切所有权仍有效时才能追加。关闭的所有者会直接报错；注册表不创建替代收件箱、模型循环或 writer。

active owner 可为精确的当前 root 调用提供 `rootOperations`。这个 Program 所有的 handle 在普通 writer 关闭后仍可使用，前提是原始 Agent 仍活跃。`runIdle()` 同步拒绝忙碌或已释放 root，在 idle maintenance 中临时恢复唯一 writer；成功释放可以唤醒已接纳待处理输入，失败则保留持久化 inbox 事实且不发起模型请求。delegated 调用不提供该 handle。registry 不拥有未来 timer 或第二个 executor。

本包还定义 `rootExecution`，由选定的 Program 提供 Provider。`ready(signal)` 等待真实 executor 与配置，由该 Program 定义。明确的 branded route 绑定 Program 的不可变配置与现有 scope，未知 route 在接纳前失败。`capture(owner)` 只接受精确附着的 root。`execute()` 等待完整 root 结算；`maintenance()` 在不产生模型 turn 的情况下执行持久化 root 事务。这些操作不转移权限，也不注册另一个 executor。

`fork(request, signal)` 使用选定的 Program 路由与已持久化的闭合源轮次创建新根目标，并在复制继承前缀、持久化精确切点后返回目标身份。Program 拥有源观察、Agent 注册、取消及唯一目标写入器；Consumer 不能提供替代 seed 事件，也不能通过源 id 转移权限。

可选的 `rootExecution.deletions` 能力将可恢复的命名空间移除及恢复交给所选持久化 Provider。Program 校验历史工作目录及确切存储版本，拒绝忙碌所有权，并排空已接纳操作。列表在明确数量上限内仅返回匹配路由的回执。缺失能力不提供删除控件或 fallback；归档元数据不授予删除权限。

<a id="model-experience"></a>
## 模型体验

间接通过 Program 拥有的执行器记录请求的子任务消息与配置；注册表不贡献模型可见文本。

#### KV Cache 影响

路由与活动所有者元数据不改变模型请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 委派操作必须配合取消；注册表没有进程终止权威。
- 注册表仅提供活动所有权。它不实现命名 Subagent provider、描述符、继续收件箱、workflow 调度或冷恢复。
- 不发布 invariant 配套：活动路由项是其贡献的唯一观察，Program 保留 Agent 与持久 Session 权威。

<a id="dev-note"></a>
### 开发备注

[执行决策](../../../../.agents/notes/implemented/architecture/2026-10-05-native-session-execution-authority.zh.md) 记录生命周期所有权与验收范围。
