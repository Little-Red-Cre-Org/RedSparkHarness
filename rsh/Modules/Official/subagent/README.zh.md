---
description: "原生子代理 Provider 适配器包索引：复用共享 Subagent 准入与生命周期契约。"
kind: "package-group"
---

# subagent/ — 原生子代理 Provider 适配器

[English](README.md) | 中文

## 摘要

`subagent/` 收录 Native Subagent Provider 的产品适配器。Engine 负责准入、谱系和父 Session writer；各适配器只负责被选中的产品传输，并通过公开 external-driver 契约报告就绪与结算。

## 包

| 包 | 职责 | Native capability |
|---|---|---|
| [`sdk-child/`](sdk-child/README.zh.md) | 通过 Host 批准的受管连接，使用标准 `dsh --profile native-sdk` launcher 运行子任务 | `externalSubagentDriver` |

## 相关文档

参见 [Subagent 参考](../../../Docs/subsystems/subagent.zh.md)了解准入与生命周期归属，并阅读所选包指南了解路由和功能限制。

## 开发备注

无。
