# Agent Note：原生根任务取消等待驻留任务清理

状态：已实现

[English](2026-10-05-native-root-cancellation-drain.md) | 中文

## 问题

初始根轮次失败后，驻留 Session epoch 可能保持开启。等待结算时若信号已取消，会在关闭 epoch 前直接拒绝，导致 writer 和生命周期消费者继续驻留。

## 决策

根执行器在初始轮次失败后关闭捕获的 epoch，并等待已有 activation 清理事务完成。等待结算先选择 epoch，再响应取消。执行和清理同时失败时，通过 AggregateError 保留两项错误。

## 后果

Program 调用方在驻留任务清理结束后收到取消结果。Session 继续由已有 activation 管理，不增加清理注册表或 writer。

## 考虑过的替代方案

由调用方清理会重复 Engine 生命周期管理，并可能影响其它 Session。
