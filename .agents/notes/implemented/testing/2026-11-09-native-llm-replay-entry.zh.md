# Agent Note: 录制会话回放提供方的 Native 入口

Status: implemented

[English](2026-11-09-native-llm-replay-entry.md) | 中文

## Problem

`llm-replay` 为每个无密钥快照场景替换模型，`snapshots/session/` 下 86 个录制场景中有 37 个直接引用它。它没有 `./native` 入口：它注册的是 Cordis 的 `llm` 适配器或 `llm/stream` 瀑布监听器，因此只有 Cordis 组合才能把它组装进去。

这是把这些场景迁到 Native profile 的最大单点阻塞。无论迁移怎么推进，Native 组合都必须先能回放一段录制的会话，任何场景才可能在它上面跑起来。

## Decision

该包发布 `./native`，提供 Native 模型执行提供方所消费的 `model` 服务。`ReplayModel` 实现与 Cordis 入口相同的按会话定位回放，并复用既有的 `loadSessionScripts` 与 `resolveScriptedEntry` 引擎，因此一段录制会话、它的 override 边车与子日志在两个运行时上含义一致。

配置与 Cordis 的 `Config` 对齐：`file`、`overrideFile`、`childFiles`、`providers` 与 `paceMs`，各自默认取相同的 `RSH_SNAPSHOT_*` 环境变量，并保留对 `paceMs` 与 fixtures 路径同样的即时报错校验。

两个行为刻意与 Cordis 入口完全一致，因为快照依赖它们。新出现的 live 会话领取下一个未被认领的脚本，因此并发会话保持录制的先后顺序。录制中不存在的 live 会话，或用尽条目的会话，会失败而不是静默继续——未录制的子代理必须暴露为错误，而不是空的模型输出。

Cordis 导出保持不变。该包仍把 `@redspark/cordis` 作为可选 peer，使 Cordis 入口仍可加载，并加入其入口所导入的 Native peer。

## Alternatives considered

**通过 `cordis-bridge` 在 Cordis 入口之上搭 Native 组合。** 否决。Native 运行时刻意不组合任何 Cordis Context，native-headless 语料用一个在构造 Context 时抛错的加载器探针断言了这一点。托管回放等于引入那些场景正好证明不存在的东西。

**给 Native 入口另写一个脚本解释器。** 否决。`loadSessionScripts` 已经解析 fixtures、override 边车与子日志，并带有语料所依赖的格式诊断。第二个读取器会在第一次 fixture 格式变更时就与 Cordis 版分叉。

**只返回一个不带 provider 目录的通配模型。** 否决。练习模型选择、图像计价、重试策略或输出 token 上限的场景都从配置的路由读取这些事实；丢掉它们会静默改变这些场景能录制的内容。

## Consequences

Native 组合现在能回放录制会话，这是迁移 `snapshots/session/` 中任何场景的前置条件。该入口不改变产品行为：它只随测试支撑层发布，且只有当 profile 指名它时才会被组装。

重复的表面是回放记账——脚本游标、未录制会话失败与 chunk 发射现在各存在两份，每个运行时一份。共享的部分（fixture 解析、条目解析、override 应用）没有重复。当 Cordis 入口最终退役时，Native 这一份是继任者，无需再次移植。

验证：`rsh/Tests/test-support/llm-replay/tests/native.spec.ts` 回放已提交的 `fs-read` fixture，断言恰好一个终结 `finish`，跨会话各步骤推进游标，并同时拒绝未录制会话与用尽的脚本。既有 558 条 Cordis 入口测试保持不变且仍然通过。
