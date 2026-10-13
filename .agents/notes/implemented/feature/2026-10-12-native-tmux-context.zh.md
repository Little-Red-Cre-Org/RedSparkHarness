# Agent Note: 持久 Native tmux 位置上下文

Status: implemented

[English](2026-10-12-native-tmux-context.md) | 中文

## 问题

Native Headless profile 需要一种可选方式，将 agent 进程当前 tmux 位置加入模型请求，同时保留唯一 Session writer，并在重启后还原相同对话。

## 决策

Official `native-tmux-context` Provider 在每轮第一步通过所选 `shell` 服务查询。它要求存在 `TMUX_PANE`，并验证 agent 进程的控制终端与该 pane 相符。查询只返回位置元数据，不会读取 pane 文本。

Cordis-free `tmux-context-definition` 包声明请求与服务类型。Native Headless 根据已加载和已提交的 Session 事件播种并更新 Provider 比较状态，等待准备完成、检查取消，再通过既有 writer 在模型派发前追加返回的 user 消息。该持久消息能在冷恢复后抑制未变化的位置，无需增加 Session 事件类型。

随附的 Native Headless profile 行保持禁用。只有明确选择的 profile overlay 才启用 Provider，并在同一组合中安装 shell 执行器。

## 考虑过的替代方案

**让 Provider 追加 Session 事件。** 这会给 Provider 第二个 writer，并让消息顺序脱离 Native Headless。应用继续独自负责 Session 追加顺序。

**在所有 Native Headless profile 中启用 tmux 上下文。** 该功能需要 shell 执行器，并会向模型请求提供位置数据。profile 保持显式选择，Provider 默认禁用。

**复用兼容 Agent pre-step Provider。** 兼容 Provider 不实现 Native 服务，也不参与 Native Headless Session 恢复。Native Provider 使用所选 shell 和 Native 应用的持久 writer。

## 后果

只读查询遵循所选 shell 的策略。缺少 tmux 状态、命令不可用或控制终端不匹配时不会添加位置消息；查询拒绝会发出 warning。取消会等待查询结束并阻止晚到的追加。由于准备只在 step one 执行，轮次中途发生的 tmux 变化会在下一轮显示。

[Native tmux-context Provider README](../../../../rsh/Modules/Official/terminal/native-tmux-context/README.zh.md)、[服务类型参考](../../../../rsh/Docs/subsystems/tmux-context.zh.md)及[Native Headless README](../../../../rsh/Engine/core/native-headless/README.zh.md)说明当前包和 Consumer 行为。
