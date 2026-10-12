---
description: "原生子任务 Provider 适配器与共享 ACP policy 元数据库的包索引。"
kind: "package-group"
---

# subagent/ — 原生子代理适配器与协议

[English](README.md) | 中文

## 摘要

本组可用于运行原生子任务 Provider，或交换带版本的 Native ACP policy 元数据。`sdk-child` 和 `codex-app-server` 提供 Provider 适配器，`acp-protocol` 负责读写共享元数据。Engine 负责准入、谱系和父 Session 写入；协议库不提供传输，也不强制执行 policy。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

按产品路由选择适配器；ACP peer 需要共享 policy 值时使用协议库。

| 包 | 职责 | 贡献 |
|---|---|---|
| [`acp-protocol/`](acp-protocol/README.zh.md) | 定义带版本的 Native ACP 子代理 policy 元数据；不提供传输或执行 | ACP 元数据 |
| [`sdk-child/`](sdk-child/README.zh.md) | 通过 Host 批准的受管连接，使用标准 `dsh --profile native-sdk` launcher 运行子任务 | `externalSubagentDriver` |
| [`codex-app-server/`](codex-app-server/README.zh.md) | 为原生外部子 agent 提供 Codex app-server 驱动；在可执行权限与执行上限之前拒绝原生请求 | `externalSubagentDriver` |

<a id="related-documentation"></a>
## 相关文档

参见 [Subagent 参考](../../../Docs/subsystems/subagent.zh.md)了解准入与生命周期归属，并阅读所选包指南了解路由和功能限制。

## 开发备注

无。
