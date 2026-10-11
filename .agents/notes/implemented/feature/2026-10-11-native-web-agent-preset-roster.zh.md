# Agent Note: 原生 Web 只读展示 Agent 预设名单

Status: implemented

[English](2026-10-11-native-web-agent-preset-roster.md) | 中文

## 问题

原生 Host 可以返回 Agent 预设名单，但原生 Web Settings 页面没有展示该名单。

## 决策

`native-application` 从选定的 `client-native-session` Consumer 传入 `agentPresetsList`，并渲染本地只读名单。页面显示每个预设的名称和可选描述，标记 Host 默认项，并标注 `needs-migration` 与 `invalid` 状态。无效项还显示 Host 提供的 `problem`。该视图不写入预设或 Session 状态，也不导入旧版预设运行时。

## 考虑过的替代方案

**保留占位文案。** 这样 Native Web 仍无法查看已有 Host 名单。

**导入旧版 `ui-agent-preset` 运行时。** 其 Settings 控件使用原有注册与管理操作，原生只读视图不拥有这些能力。

## 后果

Native Web 可以查看 Host 返回的预设名称、描述、默认项和状态。Client 呈现 Host 响应，不修改预设或 Session 状态。名单仍由 Host 负责，原生视图只读投影。

## 验证

一个 Native Application 渲染测试覆盖默认标记、描述、迁移提示、无效标记和无效原因。

## 相关内容

预设组合决策记录在[每个 Session 的 Agent 都由预设 cordis.yml 组合](../architecture/2026-08-03-per-session-agent-presets.zh.md)中。选定的 Client 操作见[原生 Session 包文档](../../../../rsh/Programs/Web/client/native-session/README.zh.md)。
