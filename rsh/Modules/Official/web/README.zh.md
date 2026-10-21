---
description: "web 访问能力家族的包映射：搜索与抓取服务、其提供方后端，以及消费它们的面向模型工具。"
kind: "package-group"
---

# web/：web 访问能力家族

[English](README.md) | 中文

## 概述

`web/` 包让模型搜索公共 web、抓取 HTTP(S) 页面，或读取明确授权浏览器文档的文本。部署可为搜索选择 Exa、Perplexity 或 DeepSeek，并通过匿名 HTTP(S) 访问抓取页面。独立的 Native 浏览器能力使用浏览器管理的授权与会话审批。可用性和上限取决于提供方；网页交互操作不在该家族范围内。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

七个包覆盖公共 web 访问与授权浏览器读取；完整词汇与约定以子系统参考文档为准。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`web/`](web/README.zh.md) | 搜索与抓取服务：通过可互换的后端搜索与抓取 URL，统一选择与错误策略 | `ctx.web` |
| [`web-search-exa/`](web-search-exa/README.zh.md) | 通过 Exa 搜索 web | 注册到 `ctx.web` |
| [`web-search-perplexity/`](web-search-perplexity/README.zh.md) | 通过 Perplexity 搜索 web | 注册到 `ctx.web` |
| [`web-search-deepseek/`](web-search-deepseek/README.zh.md) | 通过 DeepSeek 原生搜索搜索 web | 注册到 `ctx.web` |
| [`web-fetch-http/`](web-fetch-http/README.zh.md) | 匿名抓取公共 HTTP(S) 页面 | 注册到 `ctx.web` |
| [`tool-web/`](tool-web/README.zh.md) | 向模型公开 `web_search` 与 `web_fetch` | 注册到 `ctx.tools` |
| [`browser-read-only/`](browser-read-only/README.zh.md) | 授权页面读取的 Native 服务、本地管道提供器与消费者 | `browserReadOnly`，注册到 Native `tools` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考文档了解共享词汇，再看单一提供方选择服务背后的设计决策。

- [web 子系统](../../../Docs/subsystems/web.zh.md)——搜索与抓取的请求和结果、提供方可用性、`WebError` 与公开地址强制规则。
- [web 能力 seam 决策](../../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md)——搜索与抓取为何共用一项提供方选择服务。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
