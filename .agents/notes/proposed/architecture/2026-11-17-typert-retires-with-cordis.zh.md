# Agent Note：Typert 随 Cordis 一起退役

Status: proposed

[English](2026-11-17-typert-retires-with-cordis.md) | 中文

## Problem

[按实测基线的五个阶段退休 Cordis](2026-11-12-cordis-retirement-five-phases.zh.md) 把 `TypertRemoteService` 列为阶段 C 唯一没有 Native 后继的面：2026-11-12 有 23 个类继承它，其中一半在 `rsh/Programs/Web`，而且没有能力键替代它的 Remote 方法注册。[Cordis 清理保留 legacy 写入者与三个包](2026-11-15-cordis-cleanup-keeps-legacy-writers.zh.md) 把这些类和 `profile: web` 快照交给“单独的界面迁移”，却没有定义那次迁移的目标。本记录必须写明 Typert 是否搬到 Native，阶段 C 才能收口。

这个问题悬着时 Cordis 不能删：Typert 是 Cordis 形状的 RPC 面（服务上的装饰方法、由 Loader 驱动的注册表、生成的 `./typert` 与 `./remote` 产物），先删运行时会让生成的客户端指向没有服务方的描述。两个方向都代价不小——移植 Typert 会重复 Native 已经交付的传输，提前删除则会在 Native owner 出现之前拿走 legacy Web 能力。

## Proposal

Typert 只属于 legacy，随 Cordis 一起退役。Native 保持已经交付的传输：共享 Connection 注册表（`@redspark/rsh-client-connection/native-host`）加各包的 `./native` 面，见 [native-web-host](../../../../rsh/Programs/Web/host/native-web-host/README.zh.md)。任何 Typert 包、装饰器、生成器、Gateway 或 `ctx.remote` 命名空间都不获得 Native 后继。

### 本记录冻结的规则

- 已经提供 Native 面的包不再新增 `@Remote` 方法、`TypertRemoteService` 子类或生成的 `./remote` 贡献。legacy 方法保持原样直到删除；新的 Web 行为在 Native 面上实现。
- `nativePackageDirectories` 与 `nativeSafeSourceSubpaths` 中的任何包都不导入 `@redspark/rsh-typert-*`。当前树里是零引用；`verify-native-dependencies` 必须拒绝这条边，避免后续 Native 功能重新引入。
- Typert 的删除属于 Cordis 的包移除阶段（阶段 E），在阶段 B 与阶段 C 完成之后。它本身不是界面迁移的前置条件：界面迁移就是已经存在的 Native 面。

### Web 能力归属

每个由 Typert 支撑的能力，要么已有 Native owner，要么随 Cordis 专用扩展工具一起消失。尺寸取当前树：33 个包导入该协议，24 个导出的 `TypertRemoteService` 子类。

| 能力 | Typert 服务（所属包） | Native owner |
|---|---|---|
| 插件清单 | `PluginInventoryGateway`（`Programs/Web/host/plugin-inventory`） | CLI 的 `dsh-native-plugin-inventory` provider，以及 `ui-settings-plugin-inventory/src/native-*` |
| 文件上传 | `FileUploads`（`Programs/Web/client/file-upload`） | 同包的 `dsh.native` 入口 |
| 工作区文件 | `WorkspaceFiles`（`Programs/Web/api/workspace-files`） | 注册在 Native Web 路由上的 `workspace-files/native-helpers` |
| 目录选择 | `DirectoryPickerController`（`Programs/Web/api/workspace-controller`） | `directory-picker-native`、`-browse`、`-auto` |
| 工作区选择 | `WorkspaceController`（`Programs/Web/api/workspace-controller`） | `native-session` 的 Native workspaces 与 Native chooser |
| 设置、凭据、授权 | `SettingsController`、`CredentialsController`、`AuthorizationController`（`Programs/Web/api/settings-controller`） | Native 设置文档（`settings-file/native`）与 `native-application` 的 Native 设置页 |
| 会话、引用、skill 目录 | `SessionController`、`SessionFileReferences`、`SessionSkillCatalog`（`Programs/Web/api/session-controller`） | `native-web-session-controller` 与 `native-session` |
| 命令 | `CommandRuntime`（`Modules/Official/interaction/commands`） | 同包的 Native command 服务 |
| 反馈 | `MessageFeedbackService`、`SessionFeedbackService`（`Modules/Official/feedback/*`） | 两包各自的 Native definition |
| 调度 | `TaskSchedulerGateway`（`Modules/Official/automation/task-scheduler`） | `native-schedule-controller` 与 Native 调度器 |
| 子代理、目标、模型、引用 | `SubagentRuntime`、`AgentPresets`、`GoalService`、`LlmRuntime`、`SessionReferenceResolver` | `native-subagent`、Agent Presets 的 Native definition、Native Goal 服务、`native-model-selection` 与 `native-model-execution`、`session-reference/native` |
| Agent Teams | `TeamService`（`Modules/Community/experimental/agent-team`） | `agent-team/native` 提供 `agentTeams`；`tool-agent-team/native` 安装相同的九个工具（[决定](../../implemented/feature/2026-11-17-agent-teams-native-runtime.zh.md)） |
| Cordis 扩展工具 | `DynamicCordisRunnerService`，以及 `tool-cordis` 中的 `LlmRuntime`/`SubagentRuntime` | 有意不提供：这些包的存在就是运行或检查 Cordis，随它一起删除 |

### 删除范围

包移除阶段把这些一起删除，不做分批清扫：

- `rsh/Core/typert/{generator,loader,protocol,registry}` 与 `typertPlugin` 构建步骤。
- `rsh/Programs/Web/api/gateway` 与 `rsh/Programs/Web/api/remotes`，包括它们的事件转发选择与 `ctx.remote.$mount()` 组装。
- 上表列出的 Cordis 面：`*Controller` 包、`workspace-files` 与 `file-upload` 的 legacy 半边，以及 mixed Engine 包的 `@Remote` 表面；它们的 Native 面保留。
- `extensions/{tool-cordis,cordis-host-runner,cordis-client-runner,ui-cordis}`、`experimental/inspector`，以及 Agent Teams 的 Cordis 半边（其 Native 运行时建成之后）。
- 生成的 `lib/typert*.js`、`lib/remote*.js` 与声明合并及其 `package.json` exports；`Tests/test-support/remote-mock`；`typert` 的文档图谱条目；`type-equiv` 清单中的 Typert 符号；`gen-doc-graphs`/`gen-cordis-inspect-catalog` 对 `typert-generator` 的依赖。

## Alternatives considered

**把 Typert 移植到 Native。** 否决。Native 已经有带认证的通道注册表，包含 Fetch 路由、流、取消与重连行为；移植 Typert 会保留两条 RPC 管线与两套代码生成器。该注册表还响应 Loader 条目，而 Native 没有 Loader，所以这不是传输替换，而是没有当前消费者的第二套产品面。

**把 Typert 抽成无 Cordis 的通用类型化 RPC 库。** 否决。它的价值是装饰过的 Host 表面与生成的客户端合并，而所有消费者都是 legacy Cordis 组装。抽取会让生成器、Gateway 协议与 `ctx.remote` 客户端形状在其唯一消费者消失后继续存在，而 Native Connection 注册表仍然需要自己的定义。

**用 Typert 替换 Native Connection 注册表。** 否决。那会把已交付的 Native Web 认证、路由注册、客户端热重载与流回退到尚未移植的表面，并且违背阶段顺序：Native 能力是删除 Cordis 的退出条件，不是被删除的代码。

**保留类，去掉线上表面，作为普通 Node 服务。** 对 Web controller 否决。一个只负责通过 `ctx.remote` 暴露方法的 controller，在线上表面消失后不再有行为；状态与策略已经归 Native owner。

## Acceptance criteria

- `verify-native-dependencies` 拒绝 `nativePackageDirectories` 中每个包以及每个 `nativeSafeSourceSubpaths` 条目导入 `@redspark/rsh-typert-*`，并有证明拒绝行为的夹具。
- 删除后，在 `rsh/Core/vendor`、`rsh/Compatibility`、legacy 测试与 legacy 半边之外搜索 `TypertRemoteService`、`@Remote`、`@redspark/rsh-typert-` 与 `ctx.remote` 均为零。
- 删除 PR 在同一次改动中移除四个 Core 包、Gateway 与 Remotes、生成产物及其 exports、文档图谱与 `type-equiv` 条目，以及 `typertPlugin` 构建步骤；结果通过 `pnpm run build`、`pnpm run typecheck`、`pnpm run test:coverage` 与 `doc-sync`。
- 没有快照目录仍选择 `profile: web` 或 legacy SDK/ACP profile，Native Web、TUI、SDK 与 ACP 套件的模型可见输出与今天一致。
- Agent Teams 保留其 Native 运行时（`agent-team/native` 与 `tool-agent-team/native`）；删除 PR 一并移除 `TeamService`、它的 Typert 方法以及 Web Team 面板的 Remote 接线。

## Risks

Agent Teams 现在有了 Native 运行时，原先的未决依赖已经关闭。剩下的 Typert 消费方是 Web Team 面板：在该面板迁移到 Native client 之前删除传输，会拿走浏览器上唯一的 roster 与任务面，因此删除 PR 必须在同一次变更中移除该面板及其 Remote 接线。

删除之前会存在成对的界面：设置、工作区、会话与工具的 legacy `ctx.remote` 客户端与 Native 客户端。因此每个新 Web 功能要么落两遍，要么只落 Native。上面的冻结规则选择只落 Native，并接受 legacy Web 在移除窗口内不再增加功能。

生成产物是最可能的残留。`./typert` 与 `./remote` exports、声明合并、`type-equiv` 清单与文档图谱生成器都间接引用该协议；只删源码包会留下对陈旧声明通过类型检查、或在构建时失败的树。验收条件要求这些在同一次删除改动中完成。

今天的零 Native 引用没有被门禁强制。缺少规则时，后续 Native provider 可能为了 `RemoteResult` 或 `RemoteError` 导入 `typert-protocol/types`，悄悄重建本记录要移除的依赖；门禁才是这个决定里持久的部分。
