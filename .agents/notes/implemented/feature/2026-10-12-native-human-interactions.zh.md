# Agent Note：Native 工具审批与问题使用共享卡片

Status: implemented

[English](2026-10-12-native-human-interactions.md) | 中文

## 问题

Native 对话需要响应 Host 工具审批和用户提问，同时不能导入 legacy Client plugin 注册，也不能维护第二套展示实现。

## 决策

`ui-tool/native`、`ui-approval/native` 和 `ui-user-questions/native` 导出仅依赖 props 的卡片视图。Legacy 视图也适配相同的审批与问题展示组件。Native 使用现有 `answerHuman` Host 操作提交支持的审批结果或结构化问题答案；plan-review 意图已随问题 prompt 传递。

Native Host approval Provider 接受 `allowed-once` 和 `rejected`，因此审批卡提供这两项操作。Host 问题答案 API 没有仅取消单个问题的操作，因此 Native 问题卡不显示关闭操作，plan-review 卡不显示 `Chat about it`。单独的整轮取消操作仍可用。

## 考虑过的替代方案

**导入 legacy 审批或问题入口。** 这些入口会加载 Native 无法使用的 Cordis plugin 注册与 slot。

**在 Native 中复制 legacy 卡片标记。** 这会拆分展示逻辑，使 legacy 与 Native 卡片逐渐不一致。

**扩展 Native Host 协议。** 当前 Provider 不接受按 Session 审批或仅取消问题；只增加 UI wire 结果会宣称 Host 无法执行的行为。

## 影响

Native 工具卡通过生成的 `./native` 别名复用 legacy 展示和包内英文、中文文案。按 Session 允许与仅关闭问题仍是 Host API 缺口，已记录在 `/workspace/rsh-h2-notes/m2-host-needs.md`；Native 不显示这些操作。
