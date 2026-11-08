# Agent Note: Native 组合会话遥测并接管 ACP 子代理

Status: implemented

[English](2026-11-08-native-telemetry-and-acp-driver.md) | 中文

## Problem

Cordis 基线里有两行在 Native 中没有对应行。`session-telemetry-otel` 提供了 Native Provider，但没有任何 Native 配置组合它，于是 Native 会话从不导出已授权的反馈前缀——尽管 Provider、其策略门与关闭排空都已就绪。`subagent-acp` 则完全没有 Native 入口，Native 组合中也没有任何记录说明其能力由谁接管。

## Decision

`native-sdk`、`native-acp`、`native-headless`、`native-web` 与 `native-tui` 以 Cordis 基线使用的同一 id 组合 `session-telemetry-otel`。安装边界与 Cordis 逐项一致：`maxExportBatchSize` 等于 `maxQueueSize`，使排空成为单批次；当传输 promise 始终不结算时，后端 `shutdownTimeoutMillis` 是外层上界。`RSH_TELEMETRY_MODE` 与 `RSH_TELEMETRY_OTLP_URL` 保持部署覆盖，读取方式与基线完全一致。该行声明的 `launchEnvironment` 由加载器按 scope 注入满足，因此无需伴随行。

`subagent-acp` 不新增 Native 入口。ACP 子代理已通过 `@redspark/rsh-acp-child` 在进程外运行，该包向 Native subagent Provider 提供 `externalSubagentDriver`，要求 `credentials` 与 `acpChildRuntimeLauncher`，由 ACP 与 SDK 子配置选用。兼容插件仍是同一协议的 Cordis 半边；`native-package-policy.ts` 现将该包记为 compatibility-only 并点名其继任者，因此该分类陈述的是接管事实，而不只是留下未分类。

## Alternatives considered

**为 `subagent-acp` 单独提供 Native 入口。** 已否决。那会在 Native 运行时里放入同一协议载体的两份实现。ACP 驱动契约、其权限策略与子运行时启动器都已在 `acp-child` 中实现一次；第二个入口必须在今后每一次协议变更上解释为何与它分叉。

**让 `subagent-acp` 保持未分类。** 已否决。发布门禁在两种情况下当前都能通过，但未分类的兼容包不会回答“它被什么取代”，而这正是下一轮删除要问的问题。上面的条目把答案写在策略文件本身。

**只在一个配置里组合遥测，或默认为 `DISABLED`。** 已否决。每个已发布的 Cordis 模式都以 `FEEDBACK_ONLY` 启用该行，而 Provider 本身在没有持久反馈提交授权前缀时不会上传。限定到单一配置会让两个运行时对“会话导出什么”产生分歧。

## Consequences

Native 会话现在导出与 Cordis 配置相同的仅反馈前缀，运维通过 `RSH_TELEMETRY_DISABLED` 或 `DISABLED` 模式关闭遥测时，两个运行时以同一方式生效。

遥测行对测试覆盖是承重的：`native-profile-template.spec.ts` 此前断言该行不存在，现在断言其 id、插件与边界。当该行被改名移除时，这条断言会失败。

`subagent-acp` 继续作为 Cordis 半边发布。删除它需要证明 `acp-child` 覆盖了每一个 ACP 消费者；策略条目点名了继任者，但并不因此建立该结论。
