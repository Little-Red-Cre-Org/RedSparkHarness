# Agent Note：原生终端历史滚动

Status: implemented

[English](2026-10-05-native-terminal-history-scroll.md) | 中文

## 问题

原生终端仅展示最新对话行，用户无法回看已保留的消息。

## 决策

原生视图复用现有共享 viewport 计算与行数估算。Page Up 与 Page Down 修改有界偏移。发送输入、恢复 Session 或清理视图后回到底部。共享 TypeScript 入口暴露 JavaScript viewport，并保留对话行的类型。

## 考虑过的替代方案

单独实现 viewport 会重复现有终端计算。

## 影响

滚动仅改变展示，不提交模型请求，也不改写 Session 数据。配置的对话保留限额仍约束可用历史；单条大型消息仍受既有渲染器限制。
