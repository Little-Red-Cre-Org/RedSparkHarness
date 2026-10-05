---
description: "提供模型选择、会话恢复和单次审批的持续终端对话。"
kind: "package-bundle"
---

# RedSpark 终端组合包

[English](README.md) | 中文

## 概述

内置 `rsh` profile 在 `dsh-base` 之上提供交互式 Ink 终端对话。用户可以选择模型、推理强度、Agent 预设和权限预设，并恢复已存储对话。它要求交互式终端，使用现有 Agent 与 Session 服务。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

通过 `dsh --profile rsh` 启动。Windows [安装器](../../../../Scripts/install-rsh.ps1) 提供绑定检出的 `rsh` shim，并拒绝覆盖已有命令。使用 `rsh resume` 打开会话浏览器，或使用 `rsh resume <session-id>` 直接恢复。恢复使用配置的默认模型和存储的 Agent 预设。

`/model`、`/reasoning`、`/mode` 和 `/permissions` 打开选择器。其他斜杠命令使用作用域内的命令注册表；未知命令报告错误。Enter 提交或排队消息。生成期间，Esc 取消并立即提交非空草稿；Ctrl+C 只取消、不提交。空闲时 Ctrl+C 退出。`/clear` 清空视图，不删除模型历史。

审批请求使用 `y` 单次允许，或使用 `n` 拒绝。其他按键不会授予权限。取消会撤回请求。正常退出时，驱动取消排队和活动工作，等待结算并刷新 Session 后才请求关闭；刷新失败会以失败状态退出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

消息行与文本工具由[共享终端展示库](../../../../Programs/TUI/terminal-ui/README.zh.md)提供。

[组合包补丁](cordis.patch.yml) 将共享服务保留在基础组合中，并将 Agent 拥有的工具放入所选预设。具名驱动等待 Loader 完成挂载后创建 Agent。持久化事件驱动已完成的对话行，实时助手帧提供临时输出。插件释放负责 Ink 实例、定时器、审批请求和 Agent 句柄。

不发布运行时 invariant companion：渲染器使用的可独立观察关系由 Agent、Session 和预设服务拥有。开发检查为 `pnpm --filter @deepseek-ai/dsh-rsh test` 和 `pnpm --filter @deepseek-ai/dsh-rsh lint`。

界面派生自采用 MIT 许可证的 `gxinxing/deepseek-harness-tui`。许可证保存在 [LICENSE](LICENSE)，依赖声明见 [THIRD_PARTY_NOTICES.md](../../../../../THIRD_PARTY_NOTICES.md)。

所有显示文本在 Ink 应用样式前均经过终端控制字符过滤。模型输出、工具结果、会话标题和审批原因不能提供可执行的终端转义序列。

</details>

## Model Experience

None，因为驱动提交普通用户消息，所选预设拥有面向模型的提示词和工具。

#### KV Cache effect

渲染器不增加请求前缀。模型、预设和命令变更保留其所属服务的缓存行为。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 输入框为单行且不支持鼠标。
- 恢复列出共享的 `session-` 命名空间，其中包含 headless 会话；它不还原最后使用的模型路由。
- 终端输出可能保留提供方的推理内容。
- 移动检出后需要重新安装 Windows shim。

<a id="dev-note"></a>
### 开发备注

无。
