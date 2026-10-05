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

配置包含原生 headless 的工作区、模型、提示与预算，以及必填正整数限制 maxPendingRequests、maxHistoryEvents、maxPromptChars、maxFollowBufferBytes、maxFollowers。历史超限时拒绝，不进行截断。普通请求与取消／状态请求分别进行有界准入，避免提示队列占满后无法取消。

Client Consumer 提供列表、空白创建、历史、显式新建／恢复提示、取消与状态。提示成功在持久化结算后返回；执行器的确切取消原因在排空后返回 exitCode 130。每个 Session 接受一个待完成浏览器轮次。繁忙提交明确拒绝，不静默加入另一个队列。活跃历史使用确切的当前写入者；冷态历史在回复前关闭读取句柄。安装卸载撤销路由、取消请求并排空执行器。

附件、问题、审批、目录策略、标题与分叉控制属于独立 Consumer。本包不提供这些操作。

可选跟随通过经过身份验证的 POST `/api/native-session/follow` 发送已接受的持久化事件和临时助手文本。每次准入只允许一个使用确切 Session 与准入身份的跟随者。未读 SSE 队列受字节数限制；超限会取消执行并使结算失败，不遮蔽执行或清理错误。断连释放跟随者及队列；执行器保留轮次所有权直到结算。安装关闭先关闭跟随者，再排空执行。

提示先取得确切准入身份，再等待结算。调用方在发送前取消时拒绝准入；发送后取消使用该身份请求 Host 排空，直到持久化结算才结束 Promise。待结算轮次和结算等待者分别受 maxPendingRequests 限制，未领取的结果继续占用槽位。安装关闭取消并排空所有轮次。

<a id="invariants"></a>
## 不变量

选定执行器拥有写入独占与 Agent 身份。本 Program 只拥有传输准入，不引入需要运行时不变量检查的独立 Session 状态。

CLI 直接携带原生 Web Host、Session 控制器与前端静态产物包。随附 native-web Host 的运行时目录通过该确切 CLI 安装解析前端。前端包发布静态 dist 文件，不声明运行时依赖；其开发用 Cordis 图不作为运行时依赖安装。

<a id="dev-note"></a>
## 开发备注

原生 Session 执行器拥有持久化与 Agent；该包只拥有传输操作。

<a id="model-experience"></a>
## 模型体验

### 人工输入

#### 模型看到什么

人工文本进入原生执行器的持久化 inbox 与普通 Session 模型历史。该 Program 不增加工具或隐藏提示段。

#### Token 影响

`session/prompt` 的 `prompt` 文本作为普通用户消息计入当前及后续恢复请求。

#### KV Cache 影响

该包不改变历史前缀；新增用户消息延长请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 完整产品 UI、附件、审批和问题交互不由该包提供。
