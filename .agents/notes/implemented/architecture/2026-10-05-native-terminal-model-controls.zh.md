# Agent Note：原生终端模型控制

Status: implemented

[English](2026-10-05-native-terminal-model-controls.md) | 中文

## 问题

原生终端需要模型与推理选择，同时保持唯一模型目录与 Session writer。

## 决策

菜单消费实际 `modelDirectory` 与 `modelSelection` Provider。既有根执行器通过空闲时的独占 Session 维护接受选择；完整选择比较已观察的意图 revision，并刷新既有 writer。控制器在输入排空期间拒绝选择；菜单取消会等待接受的维护操作排空，再释放终端。

## 替代方案

内嵌模型目录会偏离已配置 Provider；Ink 直接写日志会绕过 Session 维护并与轮次执行冲突。

## 后果

下一轮通过共享执行器消费持久选择，并记录模型变更通知；冷恢复投影同一选择。模型元数据由 Provider 提供，仅作为参考；缺失控制与目录错误明确展示。预设、审批和策略菜单保持独立 Consumer。
