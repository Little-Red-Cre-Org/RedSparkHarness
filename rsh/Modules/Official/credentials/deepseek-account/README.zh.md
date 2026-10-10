---
description: "为 Host 账户界面提供原生 DeepSeek Platform 浏览器登录，以及安全的资料和钱包读取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-account

[English](README.md) | 中文

## 概述

原生 Host 账户界面可以登录 DeepSeek Platform，并读取经过脱敏的资料以及 CNY 或 USD 钱包余额。浏览器登录会将授权 grant 保存在凭据 Provider 中，并要求可选的 authorization 服务。本包只会向已配置的 HTTPS Platform origin 发送 grant。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在原生 Host 组合中选择本包并提供 `credentials`；加入 `authorization` 后即可启用浏览器登录。存在此 Provider 时，`llm-pi-ai` 账户服务会使用它的资料、余额和退出登录操作。

### 配置 Platform origin

原生插件输入接受一个可选字段：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `platformOrigin` | `https://platform.deepseek.com` | Platform 登录、资料、余额和退出请求所用的 HTTPS origin |

### 账户记录

Provider 将 grant 保存在 `deepseek-account/default`，并将设备 id 保存在 `deepseek-account/device`。只有 issuer 与 `platformOrigin` 相符时，grant 才可使用；格式错误或 issuer 不匹配的 grant 会显示为已退出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

授权 flow 拥有 loopback 回调，并通过选定的凭据 Provider 提交经过验证的 grant。资料和余额请求会将 Platform 响应投影为 UI 安全值，并在认证被拒后删除仍为当前值的 grant；只有同一 grant 仍保存在存储中时才会返回成功数据。

| 文件 | 作用 |
|---|---|
| [`src/native.ts`](src/native.ts) | 原生服务、记录所有权和浏览器授权生命周期 |
| [`src/protocol.ts`](src/protocol.ts) | 有界 Platform 请求和固定浏览器目标 |
| [`src/details.ts`](src/details.ts) | 资料与钱包解析 |

**运行时不变量：** 不发布 `./invariant` companion。grant 匹配与响应解析都在 Provider 请求流程中完成，不存在需要独立观察的可变关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [凭据存储](../credentials/README.zh.md)——持久记录及其 Provider 操作。
- [授权](../authorization/README.zh.md)——原生 flow 注册、取消与提交行为。
- [Pi-ai 账户](../../llm/llm-pi-ai/README.zh.md)——原生账户列表、余额和退出登录消费者。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 Platform 账户操作不会添加模型输入或更改模型请求。

#### KV Cache effect

不使缓存失效；账户状态不会进入请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制说明本包提供的账户操作范围。

- **资料和余额需要访问 Platform**——网络或响应失败会返回 `failed`，不会变成空资料或零余额。
- **远程退出仅尽力执行**——退出登录会先排空正在运行的浏览器授权，仅在读取到的 grant 仍为当前值时将其删除，然后发起有期限的 Platform 退出请求；Provider 释放时会等待所有未完成的退出请求。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
