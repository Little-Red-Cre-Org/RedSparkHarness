# Agent Note: 原生 Web Session 行不读取调度状态

Status: implemented

[English](2026-10-11-native-web-scheduler-session-list-cycle.md) | 中文

## 问题

原生 Web Session 控制器提供 `rootExecution`，而 `taskScheduler` Provider 要求该服务。控制器的可选 `taskScheduler` 依赖因此会使 Host 安装计划形成循环。

## 决定

Session 控制器不选择 `taskScheduler`，并对所有 Session 行返回 `hasActiveSchedule: false`。`native-web` profile 仍选择 scheduler，由控制器提供的 root execution Provider 为其执行任务。

## 考虑过的替代方案

**保留可选依赖。** 依赖解析器会将已选的可选 Provider 纳入激活顺序，因此 scheduler 与 Session 控制器仍会形成循环。

**将 rootExecution 移至另一个 Provider。** 这可以保留 Session 行指示器，但需要从 Session 控制器提取原生 Web executor。该改动超出本次循环修复范围。

## 验证

原生 profile 模板测试会在激活前解析完整的原生 Web Host 计划。真实 profile smoke 会通过 `dsh` launcher 启动 Host 并观察 loopback URL。

## 后果

原生 Web 不会标记带有活动调度任务的 Session。task scheduler 仍通过所选 root executor 执行和管理计划任务。
