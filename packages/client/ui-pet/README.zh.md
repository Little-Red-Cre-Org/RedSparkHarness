---
description: "面向 RedSpark 客户端的可扩展桌宠注册表、Agent 状态呈现与「通用」个性化控件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-pet

[English](README.md) | 中文

## 概述

本插件把 RedSpark 吉祥物变为可选的 Agent 状态展示。它持有桌宠持久化偏好，注册内置赤绯及正常版、Q版两种形态，占据欢迎首屏和活动会话中的 `conversation.pet`，并添加「通用 > 个性化 > 桌宠」控件。`ui-conversation` 只声明和摆放 slot，不认识任何角色、素材、设置或状态规则。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Web 组合中加入 Host 与 Client 两半。用户可以在通用设置中启用桌宠并选择角色与形态。同一份持久化 `petId` 和 `variant` 同时驱动欢迎页中央角色与应用内会话悬浮角色，因此任一选择都会同步更新两个位置。

第三方 Client 插件可以调用 `ctx.pet.register()`，提供稳定 id、显示名以及一个或多个四帧横向精灵图集。与 Electron 兼容的图集只能是受大小限制的 PNG data URL，或类似 `/plugins/provider/atlas.png` 的应用内绝对 PNG 路径；不能是远程 URL、带查询参数的 URL 或含路径穿越的路径。独立能力插件可以调用 `ctx.pet.setActivity(sessionId, source, activity)`，并在 `coding`、`working` 或 `sleeping` 等更具体状态持续期间保留返回的 disposer。

<a id="understand-the-implementation"></a>
## 理解实现

`PetRuntime` 持有注册项、偏好与临时活动报告。Session 标准状态提供默认映射：待机、运行/思考、等待交互、错误，以及短暂的完成反馈。两个位置都从同一份不可变快照读取浏览器呈现。loopback 浏览器经共享 Host settings scope 持久化偏好；远程浏览器使用明确的进程内副本，因此控件保持可用但不声称已持久化。可选 Electron 载体只接收已验证的图集帧与本地化状态，并持有透明、可拖动、置顶窗口。Host 半部注册 `ui-pet` 设置 schema；通过的变更经共享 settings scope 写入。

<a id="further-exploration"></a>
## 进一步探索

- [ui-conversation](../ui-conversation/README.zh.md)——声明并摆放通用 `conversation.pet` slot。
- [Slots](../../../docs/subsystems/slots.zh.md)——Client 组合与生命周期规则。
- [Web 客户端](../../../docs/subsystems/web-client.zh.md)——浏览器包加载与 Session 标准 props。

<a id="model-experience"></a>
## 模型体验

无。桌宠状态仅用于浏览器呈现，不进入模型请求或 Session 日志。

#### KV Cache 影响

无；本包不组装提供方输入。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **桌面载体是可选的**——浏览器仅显示欢迎页和会话位置。用户启用「在桌面置顶显示」后，Electron 会在独立透明、可拖动、置顶窗口中显示所选帧。
- **内置素材由部署持有**——Web 应用在 `/brand/` 下提供两套赤绯图集；可分发的第三方 provider 在类似 `/plugins/provider/atlas.png` 的应用内绝对路径提供 PNG，或提供受大小限制的 PNG data URL。
- **四帧呈现**——语义状态复用待机、眨眼、挥手和开心四帧，直到未来动画格式提供各状态专用片段。

<a id="dev-note"></a>
### 开发备注

**运行时不变式：** 不发布 invariant companion，因为注册表、持久化 settings scope 与组件测试直接覆盖所属关系。渲染时把所选定义解析为已注册桌宠与形态；持久化 id 不可用时回退到首个注册项。注册项与活动报告只由各自所有者返回的 disposer 移除。
