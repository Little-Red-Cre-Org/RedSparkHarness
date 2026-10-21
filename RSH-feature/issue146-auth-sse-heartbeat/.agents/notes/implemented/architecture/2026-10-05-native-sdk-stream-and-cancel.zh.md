# Agent Note: 原生 SDK 流投影与 Session 取消

Status: implemented

[English](2026-10-05-native-sdk-stream-and-cancel.md) | 中文

## Problem

原生 SDK 客户端仅在模型结束后接收助手事件，只能通过关闭整个运行时停止任务。

## Decision

原生传输复用根观察回调，通过 session.chunk 投影已接收的 StreamChunk。新增 session/cancel，按准确 Session 身份选择当前已接收轮次。持久化提示接收前或轮次结束后，取消返回 false。TypeScript 与 Python 提供对应的 Session 与低层客户端方法，复用现有订阅收集通知。

## Consequences

取消等待选定轮次结束；排队提示与其它 Session 独立。流通知不新增 writer 或持久化日志，完成消息与中断尝试重建已接收分块。原生 profile 仍需显式选择。同 id 冷恢复保持支持；SDK Session 分叉由[分叉投影](2026-10-05-native-sdk-fork.zh.md)提供。

## Alternatives considered

关闭整个进程会取消不相关 Session。逐块持久化会新增重复持久化所有者。既有模型观察回调与轮次取消信号保留一个执行器和一份 Session 日志。
