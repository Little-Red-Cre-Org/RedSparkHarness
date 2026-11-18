# Agent Note: Agent Teams 获得 Native 运行时

Status: implemented

[English](2026-11-17-agent-teams-native-runtime.md) | 中文

## 问题

Agent Teams 是唯一一个只有 Cordis 运行时的已发布能力。`TeamService` 继承 `TypertRemoteService`，并读取 `ctx.sessionProjections`、`ctx.sessions` 与 `ctx.subagents`；`tool-agent-team` 通过 Cordis 工具注册表登记它的九个工具。无 Cordis 的 profile 完全无法创建 teammate、投递 peer 消息或暴露 Team 工具面，因此[分五个可度量阶段退役 Cordis](../../proposed/architecture/2026-11-12-cordis-retirement-five-phases.zh.md) 无法收尾：删除运行时会删掉一个产品功能。

这两个实验性包还把行为分散在 Cordis 形状的文件里。`roster.ts`、`mailbox.ts` 与 `task-board.ts` 导入了 Cordis 的 `Context` 与 `Agent` 类型，尽管它们的持久规则——名字预留、投递去重、任务 compare-and-set、teardown 顺序——并不依赖任一运行时。

## 决定

两个 Team 包都发布 Native 入口。与运行时无关的规则由共享 owner 承担；每个运行时保留一层薄适配器负责 Session 挂接与投递授权。

- `@redspark/rsh-experimental-agent-team/native` 提供 `agentTeams`。它要求 `agents`、`activeSessions`、`sessionPersistence`、`sessionProjections` 与 `subagents`，且不声明任何 Cordis 包。
- `@redspark/rsh-experimental-tool-agent-team/native` 把相同的九个值工具与一段协作提示词段落登记到每个活动成员的确切 Agent 作用域。成员资格由 `agentTeams.tryMembership` 判定，因此工具只存在于 Lead 及其 teammate。
- `journal-port.ts` 定义 `TeamJournalPort`；`journal.ts` 与 `native-journal.ts` 分别基于 Cordis Session 服务与 Native active-owner writer 实现它。`task-board.ts`、`projection.ts`、`membership.ts` 与 `session-message.ts` 现在依赖该端口以及注入的 `ownerOf`、`rootOf`、`statusOf` 查询，而不是任一运行时的服务。
- `roster.ts` 与 `native-roster.ts` 是共享成员、provisioning 与 teardown 规则上的运行时适配器。`mailbox.ts` 与 `native-mailbox.ts` 保持按运行时分开，因为投递路径授权的调用方形态不同：Cordis 用 `Agent.steer()`，Native 用 continuation owner 的 host-only Steer。
- `membership.ts` 持有与运行时无关的成员规则：确切的 live Agent、它的 root Session，以及持久 roster 行或隐式 Lead 身份。Cordis 的 `TeamService` 在 Typert 删除前继续 `extends TypertRemoteService`；Native 服务以普通方法暴露相同操作。
- `NativeSubagentRequest.id` 变为可选，使 roster 能在 provider 启动 child 之前预留持久的 child Session id。Cordis continuation 路径不传该字段，继续由 provider 选择 id。

### 包策略

两个目录都加入 `native-package-policy.ts` 的 `mixedNativeEntryDirectories`：它们同时发布 Cordis 入口与 Native 入口，因此 Cordis-only 的 peer 保持可选。Native 图通过 `cordisOwnedNativeReferences` 接入共享的 Session、LLM 与投影导入；该表现在同时覆盖 Cordis 插件宿主和两个运行时共同读取的持久词汇。`agent-team` 还把 TypeScript 解决方案拆成 `tsconfig.host.json` 与 `tsconfig.client.json`，下游引用指向各自消费的面。

### Invariant 伴随插件

Native 面不发布 `./invariant`。Cordis 伴随插件监听 Cordis 的 `session/event` 派发；Native journal 在每次变更前通过严格的 Team 投影读取权威状态，因此损坏的事件流会在该读取处失败，而不是被忽略。

## 备选方案

**从 Native 行通过 Cordis bridge 运行 Cordis Agent Teams 插件。** 已拒绝。bridge 会动态导入 `@redspark/cordis`，因此每个挂载团队的 Native profile 都会保留本次工作要删除的运行时。它也把工具安装与 Typert Remote 注册留在 Cordis 形状里。

**在 Native 入口内复制持久规则。** 已拒绝。名字预留、投递确认、任务 revision 与 teardown 顺序是两个面共享的持久规则；副本会漂移，而且每个面只会测到其中一份。因此任务板、投影、成员解析器与 Session 消息接受检查保持共享；roster 与 mailbox 因 Session 与投递操作不同，每个运行时保留一个适配器。

**只把 `tool-agent-team` 搬到 Native。** 已拒绝。工具调用 `ctx.agentTeams`；没有 Native provider 就没有可调用的服务，工具会在第一次请求时失败。

**现在就把 Web UI 搬到 Native 并删除 Cordis 半边。** 本次变更拒绝这样做。Web Team 面板消费 Typert Remote 方法；该传输只随 [Typert](../../proposed/architecture/2026-11-17-typert-retires-with-cordis.zh.md) 一起退役。Native 运行时是前提，而不是删除本身。

## 后果

无 Cordis 的 profile 现在可以运行完整的 Team 功能：创建 teammate、交换持久消息、协调任务板，以及等待或中断。`native-neutral` profile 演练相同的持久 JSONL 事件，因此一个面记录的 Team 可以在另一个面重放。

在 Typert 删除之前，Cordis 仍承载 Web Team 面板及其 Remote 方法。因此仍需保持两个入口同步：新增的 Team 操作必须加到共享领域 owner 并在两个面接线，且只有 Cordis 面发布 Typert 方法。

工具仍然占用旧 subagent 工具名，因此同时挂载 Team 工具与旧 subagent 控件的 profile 必须禁用其中一组。Native 面保持与 Cordis 面相同的固定策略文本和 Lead-only 限制。
