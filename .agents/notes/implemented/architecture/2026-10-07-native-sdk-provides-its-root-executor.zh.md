# Agent Note: Native SDK provides its root executor

Status: implemented

[English](2026-10-07-native-sdk-provides-its-root-executor.md) | 中文

## Problem

原生 SDK 应用会在 `initialize` 后创建一个 `NativeHeadlessApplication`，但其它已安装 Provider 无法解析该 Program 的根执行服务。因此 Scheduler 无法复用 SDK 选定的路由，只能另建执行器。

## Decision

原生 SDK server 提供 `rootExecution`，作为其唯一已初始化执行器的可取消 facade。`ready(signal)` 等待 `initialize` 选定执行器；调用方取消时会拒绝。其它操作转发给同一执行器，且必须在就绪后使用。此改动不增加 SDK wire 方法，也不会在 profile 未安装 Scheduler Provider 时启用调度。

SDK server 不会为已安装 Provider 创建第二个 `NativeHeadlessApplication`。SDK 自身执行器仍是根身份、路由配置、Session writer 和执行的唯一权威。

## Alternatives considered

**为 SDK 已安装的 Provider 创建第二个 headless 执行器。** 这会使根身份、配置与 writer 所有权脱离 SDK server 的执行器。

**直接访问 SDK 应用的私有 executor。** 这会绕过原生服务图，也不会为 Provider 提供声明过的就绪或所有权契约。

## Consequences

Provider 可在安装时解析此服务，但必须先等待 `ready(signal)`，再解析路由或准入任务。初始化失败、调用方取消或 SDK 关闭都会拒绝待处理的就绪请求，因此 Provider 不会阻塞应用启动。SDK 协议保持不变。

原生 SDK scheduled-origin snapshot 会通过两个 SDK 客户端，真实执行 SDK 初始化、经服务维护 Session、关闭进程，以及对同一 Session 冷恢复。

[原生 SDK Session 执行决策](2026-10-05-native-sdk-session-execution.zh.md)仍负责 SDK 进程与 Session 生命周期。
