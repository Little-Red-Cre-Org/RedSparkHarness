# Agent Note：原生 SDK 后代事件观察

Status: implemented

[English](2026-10-05-native-sdk-descendant-events.md) | 中文

## 问题

两个 SDK 从 subagent.started 发现后代订阅，但原生应用只公布根执行事件。因此真实 Session-execution 委派对这些订阅不可见。

## 决策

Program 观察活动委派所有者，通过既有执行器及确切 SDK 路由验证其显示根。持久父关系必须属于已接收根任务或已观察的后代。血缘通知先于子会话后端已接收的 Session 事件。所有者分离时撤销监听；应用关闭时先撤销并等待注册表观察结束，再关闭传输。根执行保留自己的事件投影及唯一写入者。

## 考虑过的替代方案

第二事件存储会重复 Session 日志。公布全部活动所有者会泄露共用所选 Provider 的其它 Program。从 Session 头或轮次结束事件推导 subagent.finished 会虚构子代理 Provider 结果与停止原因。

## 影响

TypeScript 与 Python 会话树订阅接收真实委派后代，不改变根响应投影。内置原生 profile 仍缺少生产子代理工具及结束结果权威。一个既有记录 Session 场景通过两个 SDK 执行真实委派及共用 Provider 的独立 Program；持久子历史保留父关系。
