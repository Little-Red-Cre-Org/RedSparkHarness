# Agent Note：终端人机取消关闭其确切根执行

Status: implemented

[English](2026-10-05-native-terminal-owned-root-cancellation.md) | 中文

## Problem

终端可以呈现选定执行器的其他 Consumer 接纳工作产生的审批或提问。这些工作没有终端本地轮次控制器，仅中止本地输入会让实际请求继续执行。Session 标识本身不能证明 Program 所有权。

## Decision

回答者在呈现前解析选定执行器确切存活的交互接收者与附着根所有者。根执行能力通过已有注销事务关闭该所有者的原始 Agent epoch。终端取消观察 Provider 的实际中止原因，排空完成前禁止准入，并保留清理失败。执行器仅在清理成功后删除关闭的执行条目；资源释放状态不明时，失败阻止建立替代执行。

## Alternatives considered

拒绝呈现不会取消执行。仅中止结算不能取消尚未保留驻留的普通轮次。人为保留驻留仍不会取消原始轮次。按 Session 标识取消可能影响其他 Program；另一注册表会重复执行所有权。

## Consequences

人机取消关闭整个根 Agent epoch，包括保留工作。后续输入通过新的 Agent epoch 恢复已记录历史。外来、委派及已释放的所有者被拒绝。清理失败时终端退出并暴露原始错误。已有 Session 事件、审计 Provider 与旧默认装配保持不变。
