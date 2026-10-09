---
description: "原生 Web Session 生命周期的共享执行与浏览器传输。"
kind: "package-reference"
---

# 原生浏览器 Session

[English](README.md) | 中文

## 概述

该不依赖 Cordis 的 Client Consumer 通过选定的 Connection RPC Provider 提供原生 Web Session 生命周期。

原生 profile 通过 `dsh.native` 行及 `./native` 导出选择本包；旧 `dsh.client` 模块表不会加载它。生产依赖包含已发布声明引用的包，但安装这些包不会激活其 NativePlugin；profile 仍必须显式选择所需的 Connection Provider。包选择与声明依赖的决策记录在[安装说明](../../../../../.agents/notes/implemented/architecture/2026-10-06-native-web-profile-installation.zh.md)中。

## 目录

- [参考](#reference)
- [不变量](#invariants)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)
- [模型体验](#model-experience)

<a id="reference"></a>
## 参考

在原生 profile 中选择本包时，必须排在 client-connection 后，并配置正整数 maxFollowBufferChars，以限制 SSE 解析缓冲区。clientNativeSession 服务提供 list、create、history、prompt、cancel 与 status。提示要求显式 resume 布尔值，并在 Host 结算后完成。调用方取消会中止非提示请求；提示取消会等待 Host 结算。Host 错误以拒绝返回；解码结果在进入 Consumer 前验证端点字段。Consumer 不维护第二个 Session 缓存或连接循环。

`./list-types` 导出 Host 与 Client 共用的纯 Session 列表 wire row。标题投影与未修改的 Session header 并列，区分已解析、不存在和读取不可用；Host 从持久标题事件生成该投影。

模型控件解码选定 Host 的目录与已安装预设元数据。模型与预设修改必须携带所呈现的持久化修订号，并在 Host 维护操作结算后完成。目录不限制显式模型路由；模型 Provider 验证解析。这些方法不拥有选择缓存。

可选提示观察者通过选定 Connection 的 Fetch 响应跟随已接受的持久化事件及临时助手文本。维护中的 eventsource-parser 处理 SSE 分帧。事件解码复用共享 Session 解析器；缺少结算终止帧、帧格式错误或观察者失败都会取消确切准入，并等待 Host 排空后拒绝。调用方取消会解除跟随，仍等待持久化结算。没有 response 支持的自定义 RPC 载体在准入前拒绝带观察者的提示。

同一 Consumer 通过选定的 `/api` 载体提供 `settingsDescribe`、带 revision 检查的 `settingsMutate`、`credentialsDescribe`、`credentialsSet` 与 `credentialsUnset`。`settingsDescribe` 返回已发布的 namespace descriptor 和所选 Host 提供的请求预算。Settings 页面依照 `maxCredentialRefsPerRead` 分批读取并聚合凭据结果；超过 `maxSettingsOperations` 的修改会在发送前拒绝，因为一次 revision 检查写入必须保持原子性。Host 将这些经过校验的限制默认为 64 个凭据引用和 512 个操作。凭据读取只返回是否存在、来源与可写性事实，凭据写入返回确认且不回显值。`NativeSessionRpcError` 保留 Host 错误码与冲突详情以便处理过期写入。

```ts type-equiv
/** Settings views and the Host-validated request budgets used by the Client. */
interface NativeSettingsDescription {
  /** Registered, redacted Settings namespaces. */
  readonly namespaces: readonly NativeSettingsDescriptor[]
  /** Per-request limits enforced by the selected Host. */
  readonly limits: {
    /** Maximum credential refs accepted by one read request. */
    readonly maxCredentialRefsPerRead: number
    /** Maximum operations accepted by one atomic Settings mutation. */
    readonly maxSettingsOperations: number
  }
}
```

提示上传携带有序的编码光栅图片；Host 在根所有者内准入它们。图片限额来自选定附件 Provider。图片读取只发送 Session 身份和已记录附件身份，并在返回 Blob 前验证响应媒体类型及字节长度。

`close()` 取消当前 Client 拥有的提示并等待 Host 结算回复；原生安装器在卸载时等待该操作。

已发布声明引用 native-runtime、client-connection、native-model-selection、agent-presets 与 brand，因此这些包作为生产依赖安装以供类型解析。共享 Session 包仍为 peer，因为事件验证与格式解释使用应用的同一份 Session 实现。

提示先取得确切准入身份，再等待结算。调用方在发送前取消时拒绝准入；发送后取消使用该身份请求 Host 排空，直到持久化结算才结束 Promise。待结算轮次和结算等待者分别受 maxPendingRequests 限制，未领取的结果继续占用槽位。安装关闭取消并排空所有轮次。

<a id="invariants"></a>

跟随流也传输临时审批与问题批次。answerHuman 只使用本 Consumer 尚未结算的调用标识；Host 校验待答根所有者与输入。审批决定为允许一次或拒绝。问题答案保留所选标签与自定义文本。这些展示不形成第二份持久日志。

## 不变量

本包不发布运行时不变量伴生入口，因为 Client 的每 Session 准入映射和待处理 Promise 用精确 Host 准入标识关联传输调用、取消和人工回答；持久 Session 事件与写入者身份仍由 Host 拥有，因此 Client 不保留第二份 Session 投影。

<a id="dev-note"></a>
## 开发备注

原生 Session 执行器拥有持久化与 Agent；该包只拥有传输操作。

<a id="model-experience"></a>
## 模型体验

### 人工输入

#### 模型看到什么

提交的人工文本及已准入的持久化图片引用通过 Host 执行器进入模型输入；本包不贡献模型工具或提示段。

#### Token 影响

`session/prompt` 的 `prompt` 文本作为普通用户消息计入当前及后续恢复请求。

#### KV Cache 影响

该包不改变历史前缀；新增用户消息延长请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 完整产品 UI、文件及音频上传不由该包提供。
