# Agent Note：Native 工具审批与问题使用共享卡片

Status: implemented

[English](2026-10-12-native-human-interactions.md) | 中文

## 问题

Native 对话需要响应 Host 工具审批和用户提问，同时不能导入 legacy Client plugin 注册，也不能维护第二套展示实现。

## 决策

`ui-tool/native`、`ui-approval/native` 和 `ui-user-questions/native` 导出仅依赖 props 的卡片视图。Legacy 视图也适配相同的审批与问题展示组件。Native 使用现有 `answerHuman` Host 操作提交支持的审批结果或结构化问题答案；plan-review 意图已随问题 prompt 传递。

Native wrapper 只为 `canAllowSession: true` 提供可选会话动作，并通过既有 Host 答案 API 发送 `approval/allowed-session`。问题取消回调复用通用关闭与计划讨论，为整个待答批次发送 `cancel-questions`。范围准入和轮次执行仍由 Host 拥有。

## 考虑过的替代方案

**导入 legacy 审批或问题入口。** 这些入口会加载 Native 无法使用的 Cordis plugin 注册与 slot。

**在 Native 中复制 legacy 卡片标记。** 这会拆分展示逻辑，使 legacy 与 Native 卡片逐渐不一致。

**在浏览器内推导权限范围。** Host 准入可复用范围并验证展示所有权；Client 回调不能扩大这项权限。

## 影响

Native 工具卡通过 `./native` 共享 legacy 展示和包内英中词典。审批与计划动作在窄屏换行。关闭待答问题取消的是批次，而非单个草稿或整轮。确认失败会释放本地忙碌状态并保留 prompt；迟到的答案结果不能更新其他会话或 prompt。只有 Host 移除才能清除展示。
