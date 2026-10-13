---
description: "原生子任务 Provider 适配器与共享 ACP policy 元数据库的包索引。"
kind: "package-group"
---

# subagent/ — 原生子代理适配器与协议

[English](README.md) | 中文

## 摘要

本组可用于运行原生子任务 Provider，或交换带版本的 Native ACP policy 元数据。`sdk-child`、`acp-child` 和 `codex-app-server` 提供产品适配器，`acp-protocol` 负责读写共享元数据。Engine 负责准入、谱系和父 Session 写入；协议库不提供传输，也不强制执行 policy。

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
| [`acp-child/`](acp-child/README.zh.md) | 在父级路由与文件 policy 上限内，通过 CLI 固定的 `native-acp-dsh-child` launcher 运行不透明 ACP 子任务 | `externalSubagentDriver` |
| [`codex-app-server/`](codex-app-server/README.zh.md) | 提供 Native Codex app-server 驱动；若缺少精确选中 prepared model generation 的 Responses transport，或无法执行请求的父级 `maxTokens` 上限，则在子进程启动前拒绝请求。Codex 产品成功执行仍未验证。 | `externalSubagentDriver` |
| [`subagent-claude-code/`](subagent-claude-code/README.zh.md) | 在 Native 父级准入、进程所有权与工作区读取限制下运行 Claude Agent SDK | `externalSubagentDriver` |

<a id="related-documentation"></a>
## 相关文档

参见 [Subagent 参考](../../../Docs/subsystems/subagent.zh.md)了解准入与生命周期归属，并阅读所选包指南了解路由和功能限制。

<a id="dev-note"></a>
## 开发备注

无。
