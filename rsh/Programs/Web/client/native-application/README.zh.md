---
description: "使用选定 Session 权威的原生 Web 对话。"
kind: "package-reference"
---

# 原生 Web 对话

[English](README.md) | 中文

## 概述

此无 Cordis 的 Client 应用为显式 native-web profile 提供对话页面。选定 renderer 挂载 React；client-native-session 提供经过身份验证的 Host 操作。

根 Tool 调用与持久化结果、失败标识及呈现元数据配对，通过共享 Tool 卡片模型呈现。冷历史使用相同投影；不呈现尚不可用的文件打开和轨迹操作。嵌套分派记录保留在原始 Session 披露中，不建立独立的嵌套卡片层级。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="reference"></a>
## 参考

页面列出已存储 Session、创建空白 Session、选择持久化历史，并通过显式 resume 发送用户文本。取消期间页面保持忙碌，直至 Host 回复确认执行结算且历史刷新完成。安装释放会取消未完成调用，并等待其结算后释放视图控制器。控制器只保留呈现状态，不建立第二个 Session writer、Agent registry 或连接循环。

只需视图状态控制器的消费者可从 `@deepseek-ai/dsh-client-native-application/controller` 导入 `NativeConversationController`；此 ESM 入口不会加载 React 页面安装器。其声明使用 native profile 必须提供的 `client-native-session` Consumer 类型。

模型与推理强度选项来自 Host 模型目录，包括 Provider 失败；目录只提供发现信息，不作为准入白名单。发现结果不含当前记录路由时仍显示该路由。修改携带所呈现的持久化修订号，结算后刷新历史，并显示过期选择失败。已安装预设复用既有空白根锁与 epoch 切换；锁定的 Session 不能更换组合。

转录复用共享 Session 的 append-origin 和消息投影规则。替换副本只用于模型；原始 Session 记录可通过折叠面板查看，包括工具结果、权限、中断及不透明 ignorable 事实。传输和历史错误会显示；发送失败时保留草稿。

配置必须提供正整数 maxLiveTextChars 和 maxLiveEvents，并可选接受 `locale: "en" | "zh"`；省略时采用浏览器的中文语言偏好，否则使用英文。产品文案来自页面完整的类型化字典对。Settings 页面读取活动 Settings 注册项发布的 schema，以带 revision 检查的 JSON 编辑器修改用户覆盖，并根据 `credential-ref` 字段生成只写凭据控件。可新增、删除或替换不含机密值的对象项；隐藏机密值下方的可见修改按叶子路径写入，不安全的机密结构修改会被拒绝。数组按现有索引修改，不支持的数组结构修改会报错。凭据值只发送到 Host 保存，绝不回读。页面不新增持久化语言偏好或默认 profile 切换。

React、Session 消息投影与原生 Session 错误类通过 peer 依赖共享实例。Session 数据类型仍是纯类型依赖；运行时 Session Consumer 由所选 capability 提供。

native-web 首次使用组合只选择此应用、renderer、Connection 与 Session Consumer；旧默认组合保持不变。

<a id="invariants"></a>

待答工具审批提供允许一次与拒绝操作。问题卡保留标题、详情、选项、多选及自定义文本。提交失败保留待答请求；取消禁用输入，并在 Host 结算前保持执行忙碌。重载恢复持久化决策与工具结果事实，不恢复过期待答展示。

图片上传使用公布的附件限额及选定 Session 的下一模型。渲染器只展示持久化图片引用，并拥有每次读取、Blob URL 及卸载清理。重新加载从已记录 Session 再次读取图片。上传失败保留输入以便修正。

任务面板读取权威 todo/write 快照，包括已接受的实时与恢复历史。每次替换完整列表，只在 turn/start 清空；turn/end 保留最后的计划。状态文案由 locale 提供，面板不修改任务。

## 不变量

此视图读取选定的 Host Consumer，且不拥有独立执行观察，因此不发布不变量伴生包。

<a id="dev-note"></a>
## 开发备注

生命周期所有权见[对话决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-conversation.zh.md)；实时发送与结算见[跟随决策](../../../../../.agents/notes/implemented/architecture/2026-10-05-native-web-session-follow.zh.md)；Settings 与 Credentials 界面见[原生 Settings 决策](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-settings-credentials.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 用户对话

#### 模型看到什么

提交的用户文本及已准入的图片引用记录为 `user/message`。模型意图修改是持久化 `model/selection` 事实；已安装组合的修改使用 `agent-preset/selected`。目录发现与查看历史不贡献模型输入。

#### Token 影响

提交的文本增加普通用户消息 token。此应用不贡献工具或 prompt section。

#### KV Cache 影响

Host 拥有恢复后的上下文和既有前缀。模型与组合修改遵循其所属 Provider 的记录解析及上下文规则。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

持久化事件在执行期间更新转录。临时助手输出独立显示，直到持久化助手记录或结算将其替换。maxLiveTextChars 只保留可见尾部并明确提示截断；maxLiveEvents 拒绝超量呈现历史并取消轮次。重新加载恢复持久化历史，不恢复临时片段。

- 随附 native-web 模板具有模型选择，但没有常驻预设组合；自定义 profile 可安装这些组合。
- 嵌套 Tool 调用层级及其他模型片段呈现仍属于独立工作。
- 文件上传、完整 Sidebar、布局、浏览器授权流程、不透明凭据 grant 编辑及完整旧版插件 Settings 页面仍属于独立的原生 Client 迁移。
- Settings owner 必须显式发布 schema 元数据；此页面不编辑隐藏的 `role('secret')` 值，也不创建授权 grant。
