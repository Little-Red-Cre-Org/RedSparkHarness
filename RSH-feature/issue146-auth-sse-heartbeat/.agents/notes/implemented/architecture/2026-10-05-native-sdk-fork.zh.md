# Agent Note：原生 SDK 已结束轮次分叉

状态：已实现

[English](2026-10-05-native-sdk-fork.md) | 中文

## 问题

原生 SDK 调用方不能基于已接收历史创建独立 Session，尽管 Engine 已提供持久化根分叉。

## 决策

native-sdk 协议提供 session/fork，两个 SDK 提供 Session 与客户端方法。Program 通过已有 rootExecution.fork 传入显式路由、可读源、新目标以及可选已结束轮次事件锚点。随附 profile 安装已有 Session-execution Provider，Program 显式要求执行与活动所有者服务。

## 后果

目标获得持久化继承历史，不产生模型请求。其下一次提示恢复该历史，源字节保持不变。工作区、源所有权、已结束轮次选择及新目标准入继续由 Engine 管理。不增加第二个 writer 或历史存储。兼容 SDK profile 不提供此方法。

## 考虑过的替代方案

由 SDK 客户端复制历史会重复已发布格式与存储准入。重新运行源提示会调用模型并改变已接收事实。
