# Agent Note: 原生 Session 追加守卫

Status: implemented

[English](2026-10-03-native-session-append-guards.md) | 中文

## 问题

持久终端在父 turn 结束后仍可保留创建时选择的隔离模式。拒绝后续终端操作不能阻止进程仍存在时，沙箱模式事件进入父 Session。

## 决策

Session 对已验证且不可变的事件拥有同步追加前守卫。拒绝保持日志和下一序号不变；确切注册拥有独立释放函数，并拒绝守卫递归追加。恢复会加载已记录事件而不派发这些检查。

资源 Provider 可保持这些注册，直到其拥有的活动结算。策略和 Program 接入是独立 Consumer，不包含在本 Session 基础批次中。

## 影响

直接 Session.append 与 appendBatch 使用同一组注册检查。守卫不拥有持久化或添加第二个 writer。Sandbox、Terminal 和 Program Consumer 仍属于独立接入工作。

## 考虑的替代方案

在 policy.record 后检查已经过晚，因为 Session 已接纳模式事件。只守卫 setSandboxMode 会遗漏直接追加和 Program 转发的追加路径。Session 持有的追加前注册覆盖所有写入方，不复制事件发布路由。

## 验证

现有 owner 局部 append-guard 测试覆盖日志与序号不变、重复注册的确切移除及递归追加拒绝。终端生命周期和产品验收仍须分别完成。
