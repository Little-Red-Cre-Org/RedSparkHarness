# Agent Note：原生 SDK 后代事件观察

Status: implemented

[English](2026-10-05-native-sdk-descendant-events.md) | 中文

## 问题

两个 SDK 从 subagent.started 发现后代订阅，但原生应用只公布根执行事件。因此真实 Session-execution 委派对这些订阅不可见。

## 决策

Program 观察活动委派所有者，通过既有执行器及确切 SDK 路由验证其显示根。持久父关系必须属于已接收根任务或已观察的后代。血缘通知先于子会话后端已接收的 Session 事件。所有者分离时撤销事件监听，同时保留血缘供选定的 Subagent Provider 发布实际结束结果。关闭时先排空已接收的执行、再刷新传输，随后释放血缘观察。根执行保留自己的事件投影及唯一写入者。

## 考虑过的替代方案

第二事件存储会重复 Session 日志。公布全部活动所有者会泄露共用所选 Provider 的其它 Program。从 Session 头或轮次结束事件推导 subagent.finished 会虚构子代理 Provider 结果与停止原因。

## 影响

TypeScript 与 Python 会话树订阅接收真实委派后代，不改变根响应投影。内置原生 profile 仅在实际的一次性或可续接 Provider 任务结束、并与确切已观察血缘匹配后公布 `subagent.finished`；完成、失败、取消与关闭期间结束结果都来自 Provider 结果及持久子历史。该事件不是新的持久结果权威。一个既有记录 Session 场景通过两个 SDK 覆盖这些路径及共用 Provider 的独立 Program；持久子历史保留父关系。
