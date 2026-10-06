# Agent Note: Native foreground Subagent spawn

Status: implemented

[English](2026-10-05-native-subagent-spawn.md) | 中文

## Problem

原生 SDK 后代观察没有生产 Subagent 消费者或选定提供者。仅靠作用域工具限制不能约束 Headless 隐式内置工具，委派审批请求也可能扩张子权限。临时调用取消在活跃所有者观察之外关闭持久事件。

## Decision

组合原生前台服务与派生提供者，以及原生 tool-subagent 消费者。复用 Program 拥有的 Session 执行、已记录请求配置、深度与写入器所有权。通过无 Cordis 的协议包共享既有描述符、输出归并与权限文本。显式解析子预算、路由、persona 与工具限制；禁用隐式内置工具。委派审批记录既有拒绝审计，不调用可扩张权限的回答者。每个中断调用使用既有所有者修复操作。

## Alternatives considered

第二个 Agent 循环或写入器会重复执行权威。平行工具注册表无法约束既有分派器。虚构完成通知会混淆已接受的 Session 结算与提供者完成结果。

## Consequences

原生 native-sdk 配置支持真实前台派生，并在子清理后向父任务返回真实输出。一个既有记录场景验证两套 SDK、真实工具限制、深度、token 预算、作用域 persona、委派拒绝、模型错误部分输出、子取消与父任务冷恢复。TypeScript 与 Python SDK Consumer 还会在确切已观察血缘内把实际结束的 Provider 结果投影为 `subagent.finished`。后台任务、可持续子任务、外部后端、目录投影与 persona 变量插值仍属于独立能力；[SDK 后代事件观察](2026-10-05-native-sdk-descendant-events.zh.md)负责线路投影。
