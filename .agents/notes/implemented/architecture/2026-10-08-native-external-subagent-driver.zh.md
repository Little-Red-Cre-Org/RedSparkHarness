# Agent Note: 原生外部子任务所有权

Status: implemented

[English](2026-10-08-native-external-subagent-driver.md) | 中文

## 问题

Native Subagent Provider 需要运行由产品所有的子任务，同时由选定 Program 保留 Agent、Session 与 writer 权威。父级还需要持久化就绪与结束事实，且其时序应反映子任务的真实生命周期。

## 决策

Host 至多选择一个 `NativeExternalSubagentDriver`，且 `providerName` 必须选中该驱动。`resolve()` 会签发规范的一次性请求，绑定精确的活跃父所有者与调用根所有者、各自 owner epoch、选定驱动以及已解析的子任务路由、工作区和限制。Provider 只接受该返回请求对象；复制、重放或所有者替换会在启动前失败。

驱动接收 `NativeExternalSubagentRequest`，即包含父级与根 Session id 及 epoch、已解析路由、工作区、限制和用户任务的分离 DTO。它不接收 Native Agent、Session、Cordis Context 或 writer。只有产品确认子任务真实就绪后，`start()` 才会完成。随后 Native 通过父级唯一 writer 追加并刷新 `subagent/external-start`，再通知消费者。

驱动的 `result` 报告子任务结果或普通执行失败。Native 会另外等待 `dispose()` 确认整个子任务范围静止，然后才追加并刷新 `subagent/external-end`。父级 detach 会关闭新准入、取消已接受的子任务，并等待其范围清理与终止事实持久化；分离中的消费者仍可使用该 writer。

普通结果拒绝会在清理成功后传给 run 调用方，不会使父级或根所有者排空、Provider 释放失败。范围清理失败或父级 start/end 持久化失败会为精确父级、根所有者及 Provider 记录并保留；清理失败后不会写出声称已静止的终止事件。

## 考虑过的替代方案

向产品驱动传入 Native 所有者或 Session writer，会让产品适配器取得 Program 所有的身份与持久历史权威。分离 DTO 将这些权威留在选定 Program 与 Provider 内。

把 `result` 结束视作清理证明，可能会在产品尚未停止范围内全部进程时写入 `subagent/external-end`。独立的 `dispose()` 完成状态用于确认清理。

## 后果

外部契约只提供一次性执行和父级所有的 lineage。产品就绪握手、进程范围所有权与产品协议仍由选定适配器负责；这不会建立本地 Session 或子任务 transcript。
