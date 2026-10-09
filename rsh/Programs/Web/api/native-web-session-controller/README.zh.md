---
description: "原生 Web Session 生命周期的共享执行与浏览器传输。"
kind: "package-reference"
---

# 原生 Web Session 控制器

[English](README.md) | 中文

## 概述

该 Host Program 向共享 Connection 注册经过认证的 Session 操作，并使用选定的原生 Agent 与 Session 执行器。Web Host 仍是应用入口。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)
- [模型体验](#model-experience)

<a id="reference"></a>
## 参考

配置包含原生 headless 的工作区、模型、提示与预算，以及必填正整数限制 maxPendingRequests、maxHistoryEvents、maxPromptChars、maxFollowBufferBytes、maxFollowers、maxPendingHumanRequests。`maxCredentialRefsPerRead` 与 `maxSettingsOperations` 默认为经过校验的正安全整数上限 64 和 512。`settings/describe` 会随 namespace descriptor 公布这两个值；Host 在调用 Provider 前拒绝超限设置修改，保留一次 revision 检查的原子写入。凭据读取会执行公布的单请求上限。历史超限时拒绝，不进行截断。普通请求与取消／状态请求分别进行有界准入，避免提示队列占满后无法取消。

Client Consumer 提供列表、空白创建、历史、显式新建／恢复提示、取消与状态。提示成功在持久化结算后返回；执行器的确切取消原因在排空后返回 exitCode 130。每个 Session 接受一个待完成浏览器轮次。繁忙提交明确拒绝，不静默加入另一个队列。活跃历史使用确切的当前写入者；冷态历史在回复前关闭读取句柄。安装卸载撤销路由、取消请求并排空执行器。

经过身份认证的 `session/command` 端点接受 `{ sessionId, line }` 形式的一条完整已注册斜杠命令。它要求所选 Session 空闲，在确切 Program root owner 上重新校验命令，并在维护操作结算后返回共享的 `CommandExecution`。请求取消信号会传入命令；Host 会在结算前将其排空。

可选 modelDirectory 提供模型元数据与 Provider 失败；modelSelection 通过唯一 Session 维护所有者验证并记录意图。选择请求携带确切持久化修订号，并拒绝待完成轮次。保留的 writer 在目录解析及持久化选择之前占用空闲 Agent 维护准入；冷态操作保留既有维护准入。可选 agentPresets 提供已安装组合；rootExecution 执行空白根选择并等待 epoch 清理。缺少选择 Provider 时显式修改请求失败，不替换成默认值。

可选 attachments 与 modelDirectory 在根执行内解析实际下一模型后，准入有序的光栅图片上传。共享附件 Provider 验证规范编码及批量限额；只有持久化引用进入用户消息。图片读取由身份认证及完整 Session 历史约束，包含继承引用。端点拒绝其他工作区、不存在的引用及过大图片，并返回已验证的光栅字节、确切媒体类型及 no-store 响应头。目录策略、标题与分叉控制保留为独立 Consumer。

可选跟随通过经过身份验证的 POST `/api/native-session/follow` 发送已接受的持久化事件和临时助手文本。每次准入只允许一个使用确切 Session 与准入身份的跟随者。未读 SSE 队列受字节数限制；超限会取消执行并使结算失败，不遮蔽执行或清理错误。断连释放跟随者及队列；执行器保留轮次所有权直到结算。移除控制器时会关闭路由和已准入请求，先处置其 Session 执行器以取消仍保留的标题提供方工作，再排空跟随任务；即使标题提供方仍安装，排空也会等待其清理完成。

提示先取得确切准入身份，再等待结算。调用方在发送前取消时拒绝准入；发送后取消使用该身份请求 Host 排空，直到持久化结算才结束 Promise。待结算轮次和结算等待者分别受 maxPendingRequests 限制，未领取的结果继续占用槽位。安装关闭取消并排空所有轮次。

<a id="invariants"></a>

可选 approval 与 userQuestions Provider 只为本 Program 拥有的精确活动根调用接入 Web 回答者。执行器在展示或回答前捕获精确应用所有者；仅 Session 标识相同不会准入其他 Program 的请求。人工交互为每次调用按先后顺序呈现的临时请求，全局上限由 maxPendingHumanRequests 指定。回答需要经过认证的 Session、调用与展示标识；过期或取消的回答拒绝。既有 Provider 与工具消费者保持决策审计及结果持久化职责。卸载先撤销待答输入，再等待执行结束。

可选 Settings 与 Credentials Provider 复用同一经过身份验证的 `/api` Connection 载体。`settings/describe` 返回 `{ namespaces, limits }`：只包含 owner 显式发布 presentation 元数据的活动 namespace，剥离机密值并省略所有 schema 默认值，同时公布经过校验的请求预算。注册时拒绝藏在不支持 schema 节点后的机密字段。`settings/mutate` 按所显示 revision 应用可见路径修改，拒绝机密路径、超过 maxSettingsOperations 的修改以及过期写入；超限修改在 Provider 写入前整体拒绝。Provider 异常文本会替换为通用 Settings 或 Credentials 错误；revision 冲突只保留 namespace 与预期／当前 revision。凭据引用来自这些已注册 schema；`credentials/describe` 只返回 configured/source/writable 事实并执行 maxCredentialRefsPerRead 上限，set 与 unset 只返回确认，不会回读值。

将 `authorizationKeys` 设为页面可授权的凭据 key；允许列表默认为空。Host 通过 `/api` 提供 `authorization/list`、`authorization/begin`、`authorization/answer`、`authorization/decline` 和 `authorization/cancel`，并通过 POST `/api/native-session/authorization` 提供可重放的帧。回答、拒绝和取消请求必须包含当前 `attemptId`；帧不携带机密，断开连接只取消订阅，显式点击取消才会终止尝试。

## 不变量

本包不发布运行时不变量伴生入口，因为本 Program 的轮次表、准入标识和待答人工交互只为精确的执行器所有轮次协调 HTTP 请求；它们不复制 Agent 身份或持久 Session 状态。

运行时入口分块使用发布 manifest 声明的 shared-* 前缀。

CLI 直接携带原生 Web Host、Session 控制器与前端静态产物包。随附 native-web Host 的运行时目录通过该确切 CLI 安装解析前端。前端包发布静态 dist 文件，不声明运行时依赖；其开发用 Cordis 图不作为运行时依赖安装。

<a id="dev-note"></a>
## 开发备注

原生 Session 执行器拥有持久化与 Agent；该包只拥有传输操作。安装可选 modelSelection 服务后会保留所选 Session 模型。

<a id="model-experience"></a>
## 模型体验

### 人工输入

#### 模型看到什么

人工文本及已准入图片引用进入原生执行器的持久化 inbox 与普通 Session 模型历史。选定模型 Provider 将引用投影为图片输入。该 Program 不增加工具或隐藏提示段。

#### Token 影响

`session/prompt` 的 `prompt` 文本作为普通用户消息计入当前及后续恢复请求。

#### KV Cache 影响

该包不改变历史前缀；新增用户消息延长请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 完整产品 UI、文件及音频上传不由该包提供。
