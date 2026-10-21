# Agent Note：Codex 协议与 hook 事件清单

Status: implemented

[English](2026-09-27-codex-protocol-and-hook-inventory.md) | 中文

## Problem

Codex 子进程和 hook 桥接分别使用持续演进的 Codex 接口。固定版本的 app-server 可执行文件需要匹配的请求字段和真实产品验证。hook 文件也可能包含有效的 Codex 事件，但 Harness 没有对应拦截点；静默丢弃这些配置会让部分生效的配置看起来完整可用。

## Decision

Codex Provider 固定使用稳定版 `@openai/codex@0.159.0`，仅向 v2 `thread/start` 发送所选模型和非交互权限字段。无密钥测试启动该确切产品、生成其已安装协议 schema、检查可选权限字段，并通过真实 app-server 验证现有权限模式。

hook 桥接识别 Codex 0.159.0 的十二个事件名，执行其中五个有对应关系的命令 hook 点。对于已配置但未映射或未知的事件，桥接报告跳过，不虚构 Harness 事件。Windows 优先选择 `commandWindows`，其次选择 `command_windows` 别名，然后才使用 `command`；其他平台使用 `command`。hook 类型、异步执行与 matcher 限制仍以桥接文档为准。

## Alternatives considered

**将所有已识别事件视为可执行：**一些 Codex 事件没有等价的 Harness 生命周期点或载荷。在近似节点运行会改变命令的执行时机和可观察内容。

**无诊断地丢弃不支持的事件：**用户无法区分未生效的配置项与正常工作的 hook。

**跟踪预发布或未固定的 Codex 构建：**其 app-server schema 可能在没有对应包审查和真实产品测试时变化。

## Consequences

子进程集成与 hook 解析器使用可复现的 Codex 版本。桥接仍只运行五个事件，不声称完整支持 Codex hook 行为。无密钥产品测试验证协议字段和所选模式；带凭据的模型请求仍需独立的真实 API 检查。
