# Agent Note: 原生工具结果保留唯一持久所有者

Status: implemented

[English](2026-10-05-native-tool-result-acceptance.md) | 中文

## 问题

类型化程序绑定需要校验后的 JSON，模型工具则需要呈现内容。独立的执行注册表会在作用域、审批、取消以及结果何时成为持久 Session 事实方面产生分歧。

## 决策

[工具注册表](../../../../rsh/Engine/core/native-tools/README.zh.md) 让模型调用和程序绑定共享注册与准入。它捕获输出 schema，校验分离的值，应用结果 policy，并等待 finalizer。每次 executor 完成都检查调用取消，包括没有 policy 的路径。移除贡献会取消准入，并等待已接受的工作。

[Headless 应用](../../../../rsh/Engine/core/native-headless/README.zh.md) 保留现有 Session writer。工具拥有的追加回调串行提交该 writer 的待写批次。最终工具结果先持久化，再运行接受观察者；带来源的额外输入在下一次模型请求前独立记录。成功的结束标记等待当前批次结算。现有内置文件系统和 worker 执行仍是独立路径。

旧工具包的 JSON Schema 出口转发同一原生实现。Schema 类型保持唯一声明，兼容 API 的引用类型闭包不会因重复定义而遗漏它们。

## 考虑过的替代方案

只有 value 接口而没有消费应用无法执行持久化顺序。注册表内的第二 writer 会与应用竞争。取消后立即返回会在已接受 executor 结算前释放资源。把模型呈现结果作为规范程序 JSON，会使呈现变更改变绑定值。

## 后果

Session 事件字段和格式版本不变。现有 TypeScript 与 Python Session 投影保留相同结果和用户消息记录。PTC dispatch 与 SDK 呈现器可用，但真实 code-runtime Consumer 与进程 Provider 仍属于独立产品批次。本批不改变默认 profile。

## 验证

三个聚焦的注册表用例覆盖规范值、贡献替换排空与嵌套调用取消。无密钥 tool-results 场景通过已发布的 dsh profile 启动，从选定的录制 Session 派生重放，在观察者承认前检查持久化结果，比对提示词与工具旁文件，并验证冷读取的事件和字节一致。TypeScript 与 Python 通知解析器消费同一原始事件投影；这不证明原生 SDK 应用启动。本批不声称完成公开 PTC 进程启动或安装 spill 保留能力。
