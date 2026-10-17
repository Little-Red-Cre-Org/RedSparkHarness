# Agent Note: Native Web 转发 LlmError 错误码

Status: implemented

[English](2026-10-17-native-web-llm-error-code-passthrough.md) | 中文

## 问题

Host Session RPC 的兜底 catch 将模型 `LlmError` 错误码替换为 `native/session`，使 Client 无法获知稳定的失败错误码。

## 决策

[Host RPC 处理器](../../../../rsh/Programs/Web/api/native-web-session-controller/src/native.ts)转发 `LlmError.code`，并保留原消息和详情；其他错误继续使用图片或 Session 错误码。[对话错误视图](../../../../rsh/Programs/Web/client/native-application/src/conversation-error.tsx)仍根据失败文本分类，因为对话快照只保留文本。

## 考虑过的替代方案

继续只返回 `native/session` 会隐藏稳定的模型失败错误码，而文本匹配无法可靠地还原这些错误码。

## 后果

RPC 消费者可以取得模型失败错误码，显示的失败文本保持不变。图片接纳错误和非模型错误继续使用原有错误码。

## 验证

现有 [Host 测试](../../../../rsh/Programs/Web/api/native-web-session-controller/tests/native.host.spec.ts)验证了嵌套聚合错误消息，以及持久化 open 失败时传递 `AUTH` 错误码。
