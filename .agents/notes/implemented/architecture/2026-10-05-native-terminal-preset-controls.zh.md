# Agent Note：原生终端预设控制

Status: implemented

[English](2026-10-05-native-terminal-preset-controls.md) | 中文

## 问题

原生终端无法在首次轮次之前选择已安装的常驻 Agent 装配。

## 决策

终端通过 `/mode` 展示选定 Registry 的元数据。选择使用既有根执行器并提交观察到的持久化修订。完整持久历史决定首次轮次锁定与冷恢复。Registry 作用域、Agent 租约与 Session 写入者仍归 Host 所有。

## 考虑的替代方案

另建终端预设 Registry 会让选择脱离执行器的持久事实与安装生命周期。

## 影响

自定义 profile 可以选择其显式安装的常驻装配。已发布模板仍需要自己的预设安装器。选择不提交模型请求，已开始的 Session 拒绝再次切换。
