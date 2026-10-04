# Agent Note：关联 Session 事实统一接收

Status: implemented

[English](2026-10-04-session-batch-acceptance.md) | 中文

## 问题

人工权限选择记录 sandbox、approval 与 preset 事实。如果后续同步追加 guard 否决某条事实，之前已经接收的事实可能已改变策略。

## 决策

`Session.appendBatch` 在改变日志前，对全部事件做快照并校验事件、guard、surface 转换及发布回调。guard 读取批次前的日志。Store 观察者看到完整已接收批次，并按序号顺序收到事件。接收与发布期间仍禁止递归追加。

现有 SessionStore 发布通过当前观察者事件流交付已接纳批次。持久化 Consumer 仍负责 durable flush；批量接纳不承诺原子文件系统事务或接纳后回滚。现有事件信封和已提交格式代际不变。Program 持有的跟踪与权限 Consumer 不包含在本基础批次中。

Session invariant 在分离的候选 trace 上校验批次状态转换，发布时才把已接收转换应用到正式 trace。后续 dispatch veto 会放弃候选 trace，下一次追加从正式状态开始。

## 验证

现有 owner 测试覆盖后续事件否决、递归追加拒绝、无效 surface 关系、不可变连续接纳及按序存储发布。下游权限投影证据独立。

## 影响

观察者可检查同一已接纳批次中的后续事实。有状态校验使用候选 trace，Session 为后续策略 Consumer 提供确切已接纳事件身份。接纳后的持久化失败仍归 writer，不是在内存中回滚。

## 替代方案

逐条追加会在后续 veto 时留下部分策略变更，因此未采用。第二 writer 或日志回滚会改变 Session 所有权及持久历史语义，也未采用。
