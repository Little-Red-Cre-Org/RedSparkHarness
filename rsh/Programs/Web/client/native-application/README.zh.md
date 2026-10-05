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

模型与推理强度选项来自 Host 模型目录，包括 Provider 失败；目录只提供发现信息，不作为准入白名单。发现结果不含当前记录路由时仍显示该路由。修改携带所呈现的持久化修订号，结算后刷新历史，并显示过期选择失败。已安装预设复用既有空白根锁与 epoch 切换；锁定的 Session 不能更换组合。

转录复用共享 Session 的 append-origin 和消息投影规则。替换副本只用于模型；原始 Session 记录可通过折叠面板查看，包括工具结果、权限、中断及不透明 ignorable 事实。传输和历史错误会显示；发送失败时保留草稿。

配置必须提供正整数 maxLiveTextChars 和 maxLiveEvents，并可选接受 `locale: "en" | "zh"`；省略时采用浏览器的中文语言偏好，否则使用英文。产品文案来自页面完整的类型化字典对。页面不提供持久化语言偏好或 Settings UI。

React 与 Session 消息投影通过 peer 依赖共享应用实例；Session Consumer 只作为类型依赖，运行时由选定 capability 提供。

native-web 首次使用组合只选择此应用、renderer、Connection 与 Session Consumer；旧默认组合保持不变。

<a id="invariants"></a>

待答工具审批提供允许一次与拒绝操作。问题卡保留标题、详情、选项、多选及自定义文本。提交失败保留待答请求；取消禁用输入，并在 Host 结算前保持执行忙碌。重载恢复持久化决策与工具结果事实，不恢复过期待答展示。

## 不变量

视图读取选定 Host Consumer，不拥有独立执行观察，因此不发布不变量安装器。

<a id="dev-note"></a>
## 开发备注

生命周期所有权见[对话决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.zh.md)；实时发送与结算见[跟随决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-session-follow.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 用户对话

#### 模型看到什么

提交的用户文本记录为 `user/message`。模型意图修改是持久化 `model/selection` 事实；已安装组合的修改使用 `agent-preset/selected`。目录发现与查看历史不贡献模型输入。

#### Token 影响

提交的文本增加普通用户消息 token。此应用不贡献工具或 prompt section。

#### KV Cache 影响

Host 拥有恢复后的上下文和既有前缀。模型与组合修改遵循其所属 Provider 的记录解析及上下文规则。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

持久化事件在执行期间更新转录。临时助手输出独立显示，直到持久化助手记录或结算将其替换。maxLiveTextChars 只保留可见尾部并明确提示截断；maxLiveEvents 拒绝超量呈现历史并取消轮次。重新加载恢复持久化历史，不恢复临时片段。

- 随附 native-web 模板具有模型选择，但没有常驻预设组合；自定义 profile 可安装这些组合。
- 丰富工具卡片及其他模型片段呈现仍属于独立工作。
- 附件上传、完整 Sidebar、布局及 Settings 仍属于独立的原生 Client 迁移。
