# Agent Note: Native 侧默认模型选择

Status: implemented

[English](2026-11-09-native-default-model.md) | 中文

## Problem

`@redspark/rsh-agent-default-model` 发布 Agent 在没有会话级选择时回退到的那条路由。它此前只以 Cordis 服务的形式存在：`AgentDefaultModelConfig` 通过 `ctx.settings` 读取已存储的设置段，并由 Cordis agent loop 读取。

`native-headless` 有同样的概念却没有所有者。它的 `NativeHeadlessAuthority.defaultModelSelection` 回调在每次根步骤、Session 选择捕获之前被查询，而组合出的 profile 中没有任何东西提供它。因此 Native profile 只能把路由写进 `app` 行的配置里，任何设置变更都触达不到。

## Decision

该包发布 `./native`，提供 `agentDefaultModel` 服务。`NativeAgentDefaultModel` 携带组合条目，并在 `settings` 服务安装时采纳已存储的设置段：`register` 提供解析后的段，`watch` 采纳每次已提交的变更，注册随提供方一同释放。该段自第一步起就压过组合条目，因此运维在 Native 设置页修改默认值后，下一个 Agent 即可生效，无需重启。

`native-headless` 现在把 `agentDefaultModel` 作为可选服务读取，并把 `() => defaultModel.currentSelection()` 传入 authority，于是组合了该行的 profile 无需改动应用行即可获得回退。

服务类型与 branded 选择位于 `src/native-definition.ts`，沿用既有的 mixed-entry 模式：strict native owner 可以引用 mixed 包的声明模块，但不能引用其入口。因此 `native-headless` 引用的是定义模块，而非 `./native`。

该行能加载还依赖三条组合事实：本改动之前该包没有 `dsh.native` manifest、其 `tsdown` 入口只构建 `index.js`、其路径别名在跑 `gen-tsconfig-paths` 之前并不存在。三者各自以不同方式失败——invalid-package 拒绝、缺少 `lib/native.js`、以及编译器 face 从未看见该源文件。

## Alternatives considered

**继续在 `app` 行配置里设置路由。** 否决。那是静态组合条目；部署要改默认模型就得改 profile 并重启，Native 设置页也触达不到。

**把默认值并进 `modelSelection`。** 否决。`native-model-selection` 已经把 Program 当前默认值作为参数接收并记录逐会话意图，它刻意不拥有全局默认。把两者合并会把部署策略塞进逐会话服务。

**直接读取设置文档。** 否决。自行读取文档的提供方会绕开设置服务拥有的解析值发布与变更通知，并会在「写入何时生效」这一点上与 Cordis 所有者分叉。

## Consequences

Native profile 现在可以组合一个能被设置变更实时触达的部署默认模型，这与 Cordis 所有者已有的形态一致。这消除了把录制会话场景迁离 Cordis profile 的两个剩余阻塞之一：有 23 个场景点名了这个包。

该提供方是可选的。没有它的 profile 仍以 `app` 行配置作为回退，行为与之前完全相同。

验证：`tests/native.spec.ts` 覆盖无设置提供方时的组合条目、存储段压过它、采纳已提交变更，以及被拒绝的配置。把采纳调用换成空操作会让覆盖用例失败。
