# Agent Note: Native Web 默认入口与兼容浏览器归属

Status: implemented

[English](2026-10-17-native-web-default-and-compatibility-browser-owner.md) | 中文

## Problem

浏览器 API、默认 Web 页面和旧版 Cordis 壳共用一条启动路径与一个输出目录。仅有不依赖 Cordis 的 Native API，并不能让默认应用或其发布页面变为 Native；直接替换共享页面又会丢失现有 Web 与 Desktop 兼容消费者。

## Decision

`@deepseek-ai/dsh-client-web` 的根出口与 `./native` 出口公开 Native 浏览器组合 API。`./boot-page` 和 `./base.css` 仍是显式 package 出口。该包不依赖 Cordis；编译后的 JavaScript 与声明作为 Native Client API 发布。

`@deepseek-ai/dsh-web-frontend` 拥有默认 Native 应用页面及其 `dist/` 输出。Native Vite 输入为 `application/index.html`；其构建会从已解析模块图中拒绝 Cordis 包模块与 vendored Cordis 源码路径。

`@deepseek-ai/dsh-web-compatibility` 拥有 `AppWebEntry`、旧版浏览器模块表、旧版页面与 preview 页面。它从共享 Web 应用源码构建到自己的 `dist/`。其 `dist/index.html` 是旧版页面；`dist/preview.html` 和 `dist/preview/` 是私有预览产物，不进入 npm 包。现有 legacy Web 与 Desktop Host 消费者显式解析该包。Cloudflare preview workflow 构建此归属包。

Native Web 资产处理器解析 Native frontend 页面。兼容 Web 与 Desktop 资产消费者解析兼容包页面。Desktop 负责 profile 初始化与选择；本批资产处理器按显式 runtime 选择页面。

## Alternatives considered

**把两个页面变体构建进同一个包输出。** 共用输出会让某个变体覆盖或发布另一个变体需要的文件，并让包内容依赖最后一次构建。

**复制旧版浏览器 API 与应用源码。** 两份代码会逐渐漂移；两个 Vite 入口共用应用源码，只保留各自的包输出。

**Native 成为默认后删除 Cordis 壳。** 现有 Web、Desktop Host、插件模块表和 preview 消费者仍使用兼容路径。

## Consequences

默认浏览器 API 与应用拥有不依赖 Cordis 的归属和独立发行物。旧启动、模块表与 preview 通过显式兼容包保留。开发与发行构建必须依次生成两个输出；兼容 tarball 携带其 API 与旧版页面，并排除仅供 preview 使用的产物。
