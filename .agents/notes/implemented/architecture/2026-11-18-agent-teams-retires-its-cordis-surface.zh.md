# Agent Note: Agent Teams 退役其 Cordis 面

Status: implemented

[English](2026-11-18-agent-teams-retires-its-cordis-surface.md) | 中文

## 问题

[Native Agent Teams 运行时](../feature/2026-11-17-agent-teams-native-runtime.zh.md)让 `@redspark/rsh-experimental-agent-team` 与 `@redspark/rsh-experimental-tool-agent-team` 只提供 Native 实现：领域服务与九个工具都通过 `NativeContext` 注册，两个 manifest 都不再声明 `@redspark/cordis`。另有三个包只负责组合 Cordis 面：`agent-team-profile` 是一层 `cordis.patch.yml`，插入 `ctx.agentTeams` 与 Cordis 工具；`agent-team-web-profile` 在稳定 Web bundle 之后插入浏览器层；`client-ui-agent-team` 通过生成的 `ctx.remote.agentTeams` Typert 方法渲染 roster 与任务板。

服务不再有 Cordis 注册之后，任何 loader 都无法挂载这两层 profile，浏览器实现所消费的 Remote 方法 Native 服务也不提供。这三个包都是已发布产物，留在树里等于宣传一个无法启动的组合。

## 决策

删除 `agent-team-profile`、`agent-team-web-profile` 与 `client-ui-agent-team`，以及 Web 面板场景和所有点名的行。删除会牵动 CLI devDependency、公开实验包策略、`cordis-client-runner` 的 slot catalog 占用项、Web 应用测试清单、实验包表格、capability-seams 条目，以及生成的 config catalog 与 module graph。

Agent Teams 能力本身保留。它的 Web 呈现随 Cordis 面退役：Native profile 仍然提供 `agentTeams` 与九个工具，但不再有浏览器 roster。

工具目录的采集跟随该包。`gen-tool-catalog` 不再为 Team 工具挂载 Cordis 插件，而是用 stub 的 `agentTeams`、`agents`、`activeSessions` 与 `promptSections` 启动 Native 注册表，并从真实注册表读取相同的九个 schema。今后 Team schema 变化会直接出现在目录里，不需要第二套 Cordis 采集环境。

测试覆盖随实现迁移。`native-roster`、`native-mailbox`、`native`、`projection-events` 与 `session-message` 承接了被删除 Cordis 测试里的身份、provisioning、恢复、任务与事件流用例。不变式伴生入口对候选事件回放的检查，由 journal 在每次变更前的严格投影读取覆盖。

## 考虑过的替代方案

**保留三个包作为已发布产物。** 否决：它们的内容全部是 `ctx` 上已不存在服务的 patch 行，点名它们的已发布 profile 无法启动。

**在同一变更里把 roster 与任务板移植到 Native 事件。** 本次否决：这需要把 Native Team 投影暴露给客户端，并在 Web 里提供槽位，而现有 Native Web 面没有这些。那是产品新增能力，不是删除一个无法挂载组合的清理工作。

**在目录生成器里保留 Cordis 挂载配方。** 否决：该包已不再导出 Cordis 插件，生成器无法通过类型检查。

## 结果

`agent-team` 与 `tool-agent-team` 只提供 Native 实现，源码中不再出现 Cordis 服务名。[还有什么依赖 Cordis](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.zh.md) 减少三个 `cordis-only` 包，[Cordis 清理保留 legacy writer 与三个包](../../proposed/architecture/2026-11-15-cordis-cleanup-keeps-legacy-writers.zh.md) 中关于 web-profile 的条款不再适用；另外两个保留包不受影响。

挂载过 `agent-team-web-profile` 的部署会失去 Team 面板。面向模型的工具与持久 Team 状态不变。

生成的 config catalog 不再列出这两个 Team 包。它按 Cordis 入口点给包分类，而两个入口现在都是配置为 zod schema 的 Native 插件。包的 README 改为指向解析函数；等生成器理解 Native 入口形态后，这两节会回来。

## 验证

- 没有任何 manifest、tsconfig、README、策略清单或生成目录再点名这三个包。
- `pnpm install` 能解析 workspace，`pnpm run typecheck` 通过。
- `pnpm run gen-tool-catalog` 从 Native 注册表复现相同的九个 Team 工具 schema。
- `@redspark/rsh-experimental-agent-team` 与 `@redspark/rsh-experimental-tool-agent-team` 不声明也不导入 `@redspark/cordis`。

## 风险

- 删除已发布包对仓库外消费者是破坏性变更。实验性名称不提供稳定性承诺，而该组合在仅 Native 运行时变更后本就无法启动。
- Web Team UI 没有替代品。未来的浏览器 roster 应作为需要独立投影 seam 的新能力，而不是恢复 Remote 方法路径。
