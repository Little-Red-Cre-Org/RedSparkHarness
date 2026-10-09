# Agent Note: ChatGPT 计划模型使用公开 SIWC Responses 路由

Status: implemented

[English](2026-10-08-codex-siwc-provider.md) | 中文

## 问题

pi-ai 的 `openai-codex` 目录描述的是某个捆绑版本，而不是登录 Harness 的账户；其 Codex 传输也不是第三方 ChatGPT 计划应用的公开集成契约。因此，静态模型列表可能隐藏账户新开放的模型，或展示当前账户不能使用的模型。

## 决策

`openai-codex` 路由使用本应用注册的 Sign in with ChatGPT OAuth。授权流程使用 loopback callback、state、nonce 与 PKCE；它依据 OpenAI 发布的 JWKS 验证返回的 ID token，并将已保存的 subject 与签发的 client ID 绑定。现有凭据存储会在打开浏览器授权前保存稳定的 agent host ID，并在 token exchange 前保存签发的 client ID；OAuth grant 与轮换 refresh token 仍由同一凭据存储负责。此路由不读取 Codex CLI 文件，也不解码 access-token claims。

`listModels` 与 Models 页面发现通过同一个 pi-ai `Models` collection 和推理使用的已保存 OAuth grant。账户目录来自 `GET https://api.openai.com/v1/models`；picker 只加入 `models[]` 中 `visibility: "list"` 的条目，以 `slug` 作为请求 id，以 `display_name` 作为标签。全新 collection 首次精确解析模型时会在推理前加载目录，因此保存的模型无需先由界面列出。请求经由 pi-ai 的 OpenAI Responses 实现发送到公开 `POST https://api.openai.com/v1/responses` 路由。请求使用 `store: false` 与 streaming；只有 Responses 流到达终止事件后，提供方才接受其为完成。

服务端目录没有承诺上下文限制、输出 token 上限、价格或 reasoning 控件，因此适配器不发布这些字段。它会拒绝输出 token 上限和 temperature 等不支持的请求控件，也会拒绝重定向路由或替换 SIWC 权威来源的 profile 覆盖。Native ModelDirectory 会把本次操作的 signal 传入提供方模型列表，因此账户 refresh 可以随目录查询一起取消。共享 discovery 模块从 `@deepseek-ai/dsh-llm/native` 导入提供方无关的错误、API key 规范化、归因与模型发现类型；协议专属的列表解析仍由此提供方负责。

## 考虑过的替代方案

**使用 pi-ai 静态 Codex 目录与 app-server 后端。**不采用，因为它们描述的是捆绑的 Codex 版本和 Codex 专用路由，而非当前已登录账户的公开 SIWC 模型与推理契约。

**从 bearer token 解码 `chatgpt_account_id`，或复用 Codex CLI 凭据。**不采用，因为公开 Responses 流程要求模型列表与推理使用同一个 OAuth bearer，并不需要私有 backend account header。由消费端解码 token 或访问 CLI 凭据会建立第二套未文档化的认证权威。

**硬编码当前 GPT-6 标识符与能力或价格估算。**不采用，因为账户可用性与目录条目会独立于本包版本变化，公开模型列表也没有声明这些能力。

## 后果

该路由要求本应用注册的 SIWC 登录并获得 `chatgpt.tokens.use.direct`；旧 OAuth 记录或无关记录不能激活该路由。消费者请求模型列表时会刷新账户专属目录，提供方或网络失败会直接返回，不会回退到 pi-ai 捆绑的 Codex 目录。能力未知的模型在适配器公开描述中保持 text-only 且不声明尺寸。实现包含列表与推理 wiring 的 composition fixture；真实账户登录、在线目录与用户推理仍需使用真实凭据验证。

ID-token 验证将 `jose` 作为直接运行时依赖。代码审查范围是 `llm-pi-ai` SIWC 提供方及其两个 adapter 契约；不会迁移 Agent、Session 或 subagent 权威。

原生 Provider 把同一组不依赖 Cordis 的 flow 注册到可选的原生 `authorization` 服务，flow 的凭据写入携带本次尝试的 signal。token、refresh、JWKS 与目录请求各有 30 秒期限，浏览器回调最多等待 10 分钟；JWKS 通过该 signal 拉取，而不是经由 `createRemoteJWKSet`。`llm-pi-ai` 的凭据记录一经提交，适配器就丢弃缓存的 provider collection，下一次列表会用新的 grant 加载账户目录。
