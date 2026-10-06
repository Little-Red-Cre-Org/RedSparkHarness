# Agent Note: 原生子任务结束通知准入

Status: implemented

[English](2026-10-05-native-subagent-settlement.md) | 中文

## 问题

可续接子任务的最后一个 turn 可以先于 writer 和 Agent 清理结束，冷恢复也不能复用旧答案。结束通知准入期间，父任务可能开始下一个 turn；若通知排在等待该通知的 turn 后面，执行就无法继续。

## 决策

Provider 使用 Program 既有 onSettled 回调，在实际清理完成后投递通知。已消费工作和最终助手内容只从本次驻留的持久事件后缀折叠。清理失败报告 error，不附带输出。共享协议 helper 构造与兼容实现相同的运行时 subagent-settled 来源。

接收者忙碌时，Program 通过接入的精确 active owner 准入，或在当前工作结束后执行已有空闲操作。一次同步认领选择准入路径；选中实时所有者会取消并排空尚未执行的备用操作。接入监听器不等待排在自身 turn 后面的工作。准入失败保留原始原因，不改用另一个 writer 重试。

## 考虑过的替代方案

turn/end 或 owner 脱离都不能证明清理成功。复制子任务历史会创建第二权威。把所有通知排在忙碌执行后面，会使等待该通知的父任务互相阻塞。无用户 turn 就唤醒 SDK 根任务，会增加没有明确所有者的回答投影。

## 后果

根父任务在下一个用户 turn 消费通知；驻留的可续接父任务保留现有唤醒语义。关闭时抑制新通知并排空拥有的子任务。Session 和收件箱仍归 Program 所有。原生 SDK 会把实际 Provider 结束结果独立投影为 `subagent.finished`，包括关闭期间结束的已接收子任务 epoch；线路事件不会向父级投递消息或唤醒父任务。ACP 投影与目录仍是独立能力。[续接准入](2026-10-05-native-subagent-continuation.zh.md)和[兼容对话](../feature/2026-07-28-continuable-subagent-conversations.zh.md)仍保留其路由、权限与生命周期决策依据。
