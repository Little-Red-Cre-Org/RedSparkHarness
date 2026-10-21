# Agent Note: 原生 SDK Session 执行

Status: implemented

[English](2026-10-05-native-sdk-session-execution.md) | 中文

## 问题

已发布的 `native-sdk` profile 指向尚无安装入口的应用包，因此现有 SDK 传输协议缺少原生 Session 所有者。

## 决策

原生 SDK 服务是一个由 profile 选择的应用。`initialize` 绑定工作目录和模型路由，`session/prompt` 按 Session ID 将文本排队交给共享的 native-headless 执行器。执行器负责模型请求、持久事件和写入者结算；SDK 应用负责 JSON-RPC 标准输入输出、每个 Session 的提示顺序、状态通知和进程关闭。模型解析接收连接取消信号；关闭时先等待初始化结束，再由 Host 释放其提供方。TypeScript 和 Python 客户端继续默认使用 `sdk`，原生路径需要显式选择。

原生服务保留现有的三个请求方法，发送 `session.event` 与 `session.status`。提示请求仅在持久化的 `agent/inbox/spliced` 回执之后返回；回执之前的失败会拒绝 JSON-RPC 请求。是否恢复 Session 由持久化存储决定，包括进程重启之后。内联图片接纳和子 Agent 通知不属于第一批原生 SDK 范围。不支持的输入会在传输请求处明确失败，不会被静默改写。

## 曾考虑的方案

**另写一套 SDK 专用 Agent 循环。** 这会重复 Session 持久化和模型接纳，并可能与其他原生 Program 的行为分叉；现有执行器已经负责这些操作。

**立即切换两个 SDK 的默认 profile。** 现有调用方会遇到尚未实现的图片和子 Agent 能力，因此在具备同等能力前保留显式选择。

## 影响

SDK 可以通过公开的 `dsh` 启动器驱动和观察原生 Session 轮次，无需启动 Cordis。状态表示整个 Session 的活动，不归属于某一条排队提示的结果。后续能力补齐可以在不改变此传输协议的情况下加入图片接纳和子 Agent 事件。
