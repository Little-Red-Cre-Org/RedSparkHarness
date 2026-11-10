# Agent Note: Native 钩子桥接

Status: implemented

[English](2026-11-10-native-hook-bridges.md) | 中文

## 问题

Claude Code 与 Codex 桥接在兼容层扩展点上运行外部命令钩子：`agent/session-start`、`agent/pre-step`、`tools/pre-execute`、`tools/post-execute` 与 `agent/turn-stopping`。Native profile 一个都不暴露。在 [Native 工具拦截点](2026-11-10-native-tool-interception-points.zh.md) 落地之前根本没有逐调用决策点；即便落地之后，Claude Code 七个事件点里仍有四个没有 Native 对应物：Native 桥接既无法观测会话启动，也无法应答已提交的提示词，更无法在停止边界请求再走一步。

这个缺口不是表面问题。`snapshots/session/` 里有十四个场景真的会运行钩子，而迁移目标是在 Native profile 上重放每一个录制会话。一个迁移后钩子静默失效的场景仍会「通过」，因为录制事件仍然吻合，但产品失去了该场景所验证的能力。

## 决策

两个桥接在各自的 Cordis 入口旁发布 `./native` 入口。它们共享配置解析、方言 payload 词汇、matcher、命令 runner、结果合并与持久 `hook/invoked`/`hook/result` 事件对；只有扩展点接线不同。`@redspark/rsh-hook-protocol/native` 重新导出与框架无关的那一半，因此 Native 桥接永远不导入 Cordis 包根。

Native 运行时新增了桥接所需的两个接缝，每个都是能表达对应兼容点面的最小接缝：

- **`session/starting`**——`native-headless` 每个会话广播一次的并行 Native 事件，位置在首个输入已持久之后、首个请求构建之前。桥接通过注册 request-context provider 来应答它，因此首个请求会等待钩子上下文，而不是与其竞争。兼容点面是分离运行的，可能错过首个请求；Native 点面由引发它的那个请求等待。
- **`turn/stopping`**——当一个回合产出最后一步、且没有已记录的工具调用继续它时广播的串行 Native 事件。被等待的监听器可以准入一条 `next-step` 收件箱消息；应用会重新读取该批次，只有出现新消息才开启下一步。什么也没加的监听器让回合正常结束。这取代了 `steer()`，Native Agent 没有对应的东西。

两个工具点面来自拦截服务；`UserPromptSubmit` 映射到活动 owner 的 `beforeStep` 准入钩子，那是 Native 程序的 pre-step 决策点，也是提示词能在步骤开启前被拒绝的唯一位置。

三项兼容能力没有 Native 对应物，被记录为缺口而非模拟：`SubagentStart`/`SubagentStop`（Native subagent 接缝不广播子级生命周期边）、`{"continue": false}` 的运行级中止、以及 `updatedInput` 改写。三者都在两个包的 README 中列明。

## 影响

安装 `@redspark/rsh-hooks-claude-code` 或 `@redspark/rsh-hooks-codex` 的 Native profile 会用同一份 hooks.json、同样的 payload 形状运行同样的钩子，写入同样的持久事件对，产出同样的模型可见决策，因此一个场景可以在两个运行时之间移动而录制不变。

生命周期事件是 Native 应用的能力，不是钩子的能力：任何 Native 插件都可以应答它们。`native-headless` 增加它们时没有改变已录制的输出，native-headless 套件以未改动的重放证明了这一点。

`session/starting` 采用并行是刻意的：一个慢钩子不得拖慢首个请求。代价是被应答的钩子上下文通过 request-context provider 抵达，而不是通过广播本身，并且比请求准备更慢的钩子仍会错过那个请求——这与兼容桥接的行为相同，现在是被明确陈述而非偶然。

`turn/stopping` 采用串行同样刻意：应用必须在关闭回合前知道批次是否增长，因此监听器按注册顺序运行，应用会等待全部完成。

这三个包现在是 `rsh/Scripts/native-package-policy.ts` 中的 mixed 入口，两个桥接包把 `./native` 发布为安全源子路径，使其无 Cordis 的那一半在退役过程中仍可用。

`rsh/Modules/Official/hooks/*/tests/native.spec.ts` 用真实钩子命令脚本与替身 shell 服务覆盖两个入口；钩子套件在 Linux 上运行，因为 Windows 通道因其中的 POSIX 钩子命令而排除它们，这与本次改动前一致。

## 备选方案

- **让桥接自带决策路径，而不是新增 Native 接缝。** 否决：拦截服务已经拥有工具决策，第二条路径会漂移。生命周期事件无论如何都需要，因为没有插件能凭空发明一个停止边界。
- **把 `session/starting` 做成串行，让钩子上下文落在广播本身里。** 否决：那样一个永不退出的钩子会拖慢每个会话的首个请求，而兼容桥接从来没有这种权力。
- **让 `turn/stopping` 返回布尔值而不是观测收件箱。** 否决：准入必须在回合决策前持久，而持久收件箱正是强制继续该待的地方——把它复制成返回值会让两者互相矛盾。
- **从 `agent/created`/`agent/disposed` 模拟 `SubagentStart`/`SubagentStop`。** 否决：那两个事件广播每个 Agent（含根 Agent），没有父级归属，桥接无法区分 subagent 与根会话，会为主会话触发 SubagentStop 钩子。缺口保持列明，直到 subagent 接缝广播子级边。
