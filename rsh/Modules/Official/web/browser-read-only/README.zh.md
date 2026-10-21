---
description: "读取 Chrome 明确授权文档的 Native 工具，支持撤销。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-read-only

[English](README.md) | 中文

## 概述

此可选 Native 包提供 `browserReadOnly`，并向现有工具注册表注册 `browser_tabs`、`browser_read`。Chrome 扩展管理文档授权；应用管理审批、模型请求与 Session 持久化。安装方法见 [Windows 配置指南](../../../../Docs/user/guide/browser-read-only.zh.md)。

## 目录

- [配置与服务](#configuration-and-service)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="configuration-and-service"></a>
## 配置与服务

`./native` 入口面向 Host，依赖 `tools`。读取还需要应用现有的审批服务与应答方；缺失或拒绝时返回工具错误。安装时解析并验证默认值。

| 字段 | 默认值 | 约束 |
|---|---|---|
| `connectionFile` | 必填 | 绝对路径，尚未占用，位于仅当前系统用户可访问的目录。 |
| `readTimeoutMs` | 15000 | 整数 100–120000，也限制认证等待时间。 |
| `maxTextChars` | 60000 | 整数 1–100000，每次读取的 UTF-16 字符数。 |
| `maxGrants` | 8 | 整数 1–64。 |
| `maxPendingReads` | 4 | 整数 1–32。 |

`resolveBrowserConfig(input)` 返回完整 `BrowserReadConfig`。`BrowserReadOnly.open(config)` 为随机、需认证的本地管道独占创建发现文件。`status()` 返回连接状态及 `BrowserGrant`（`id`、`url`、`title`）。`read(BrowserGrantId, AbortSignal)` 返回 `BrowserPage`（`url`、`title`、`text`、`truncated`）。撤销、断开、超时、取消或提供器停止都会拒绝待完成读取。导航和刷新使扩展中的文档授权失效。重新授权生成新标识；重连不恢复授权。`close()` 释放套接字，仅删除自身拥有的发现文件。并发实例须使用不同文件；残留文件会使启动失败，不会被覆盖。

注册表管理两个工具贡献及其释放。服务定义、管道提供器与工具消费者在同一包内共同演进。不发布 invariant 配套入口：授权与待完成请求只有一个权威，接受结果前会核对有效授权。转发程序与扩展均不写入 Session。

传输的 1 MiB 上限适用于单条消息，与流分块边界无关。接收器先验证帧头，再分配一个正文缓冲区，并按偏移写入分片。弹窗将用户操作排在进行中的请求之后，并在轮询时保留未变化的页面控件。重新授权仅在文档验证成功后替换原授权；发布新授权时检查授权数量上限。

<a id="dev-note"></a>
## 开发备注

`tests/browser.spec.ts` 覆盖连接准入及授权生命周期。[浏览器记录场景](../../../../../snapshots/native-headless/browser-read-only/snapshot.yml) 使用确定性浏览器对端和模型运行随附 Native profile，验证审批、持久化工具结果与冷启动读取。实际 Chrome 验收另行覆盖扩展与 Native Messaging；模拟对端本身不能证明某个浏览器版本可用。

<a id="model-experience"></a>
## 模型体验

### 浏览器工具与来源文本

#### 模型看到什么

`browser_tabs` 仅返回明确授权页面的元数据。`browser_read` 接收一个 `grant_id`，请求现有会话审批，输出有长度上限的正文、标题和来源网址。通用工具结果卡显示同一文本。成功结果、错误和审批决定由应用现有 Session 写入方记录。工具提示模型把网页内容作为不可信资料并引用来源网址；提示不能使任意网页内容变得可信。

#### Token 影响

安装启用期间存在两个工具 schema。列表操作加入授权元数据；每次读取加入正文与来源字段。`maxTextChars` 限制文本字符数，不限制模型 token 或提供商费用。失败时加入错误说明，不加入网页正文。

#### KV Cache 影响

安装不变时 schema 保持稳定。页面元数据、正文和错误追加到会话，改变其后缀；安装或移除工具可能使变更后的工具定义及后续内容无法复用缓存。本包不保证缓存命中。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 配套注册脚本支持 Windows Chrome Native Messaging。私有辅助程序仅在 Chrome 与本地管道之间转发有帧头的 JSON，不是应用启动器。每次明确授权前须获得 Chrome 的 `activeTab` 权限。授权适用于所连接的 Host；会话审批决定具体读取。撤销会阻止后续读取，但不清除历史会话记录或模型请求。

- 提取范围为顶层文档中首个 `main`、`article` 或 main 角色元素，否则为 `body`，排除表单、按钮、可编辑区域与隐藏文本。不点击、输入、导航或提交表单，不读取 Cookie，不检查子框架或影子根，不提取图片、OCR 或解析 PDF。同一文档内动态变化可改变后续读取内容；可见文本仍可能含个人信息。不自动重连或重试；Chrome 必须保持运行。其他浏览器和平台未验收。本地软件不要求订阅；模型推理可能收费。
