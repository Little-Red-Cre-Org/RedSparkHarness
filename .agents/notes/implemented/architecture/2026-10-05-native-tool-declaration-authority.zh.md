# Agent Note: 纯工具声明权威

Status: implemented

[English](2026-10-05-native-tool-declaration-authority.md) | 中文

## 问题

原生与兼容 Consumer 需要相同的文件 diff 字段和持久 PTC 事件 payload，不应为此导入 Cordis 工具注册表。分别声明可能使同一记录数据的描述发生偏离。

## 决策

NativeTools 在纯 presentation 出口拥有 FileDiff，在纯 types 出口拥有两个 PTC payload 和 SessionEventMap 成员。Tools 转发这些声明。Host 与 Client 编译面仅共享这些叶；原生注册表仍仅属于 Host。

## 后果

经 Tools 的现有导入保留相同类型与 Session 扩展。事件名、payload 字段、已知事件词汇及已发布 Session 世代保持不变。此次声明发布不增加 PTC 执行、结果策略或另一个写入者。

## 考虑过的替代方案

复制 payload 会分裂记录数据权威。导入兼容注册表会让原生声明不必要地依赖 Cordis。发布未使用的限制接口会在没有 Consumer 时扩大 API。

## 验证

拥有者编译与发布检查验证两个声明叶及兼容转发出口。持久化目录生成器在 NativeTools 源码定位 PTC 事件；事件词汇保持不变。
