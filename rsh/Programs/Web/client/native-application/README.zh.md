---
description: "使用选定 Session 权威的原生 Web 对话。"
kind: "package-reference"
---

# 原生 Web 对话

[English](README.md) | 中文

## 概述

此无 Cordis 的 Client 应用为显式 native-web profile 提供对话页面。选定 renderer 挂载 React；client-native-session 提供经过身份验证的 Host 操作。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="reference"></a>
## 参考

页面列出已存储 Session、创建空白 Session、选择持久化历史，并通过显式 resume 发送用户文本。取消期间页面保持忙碌，直至 Host 回复确认执行结算且历史刷新完成。安装释放会取消未完成调用，并等待其结算后释放视图控制器。控制器只保留呈现状态，不建立第二个 Session writer、Agent registry 或连接循环。

转录复用共享 Session 的 append-origin 和消息投影规则。替换副本只用于模型；原始 Session 记录可通过折叠面板查看，包括工具结果、权限、中断及不透明 ignorable 事实。传输和历史错误会显示；发送失败时保留草稿。

配置仅接受 `locale: "en" | "zh"`；省略时采用浏览器的中文语言偏好，否则使用英文。产品文案来自页面完整的类型化字典对。页面不提供持久化语言偏好或 Settings UI。

native-web 首次使用组合只选择此应用、renderer、Connection 与 Session Consumer；旧默认组合保持不变。

<a id="invariants"></a>
## 不变量

视图读取选定 Host Consumer，不拥有独立执行观察，因此不发布不变量安装器。

<a id="dev-note"></a>
## 开发备注

生命周期所有权与持久化转录刷新、流式呈现的区别见 [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 用户对话

#### 模型看到什么

只有记录为 `user/message` 的提交用户文本进入现有 Host executor。查看历史或原始记录不贡献模型输入。

#### Token 影响

提交的文本增加普通用户消息 token。此应用不贡献工具或 prompt section。

#### KV Cache 影响

Host 拥有恢复后的上下文和既有前缀；UI 选择不修改 Session 事件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 转录在执行结算后刷新；实时模型输出仍属于独立 P4 工作。
- 附件上传、审批与问题回复、完整 Sidebar、布局及 Settings 仍属于独立的原生 Client 迁移。
