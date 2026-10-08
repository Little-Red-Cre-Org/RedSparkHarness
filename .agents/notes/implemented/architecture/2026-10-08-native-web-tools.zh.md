# Agent Note: 原生网页搜索与抓取共享 Cordis 核心

Status: implemented

[English](2026-10-08-native-web-tools.md) | 中文

## 问题

`web_search` 与 `web_fetch` 此前只能通过 Cordis profile 使用。原生 headless、web 与 TUI profile 需要相同的工具、Provider 选择、凭据流程、设置与模型可见输出，且不能另写一套可能与 Cordis 路径产生偏差的实现。

## 决策

这是一次框架迁移，而不是重新实现。`rsh/Modules/Official/web/` 下的六个包均为混合包：业务逻辑位于与框架无关的模块（`selection.ts`、`config.ts`、`provider.ts`、`search-core.ts`、`fetch-core.ts`），Cordis 入口（`index.ts`）与原生入口（`native.ts`）调用的是同一份代码。只有注册胶水不同：一侧是 Cordis 服务与 `ctx.effect`，另一侧是 `NativeContext.provide`/`require`/`effect`。

- `@deepseek-ai/dsh-web/native` 提供 `web`，复用共享的执行时选择、重复 id 拒绝、`maxResults` 截断与 `WebError` 错误码。配置中的固定选择优先于启动环境 process 层的 `DSH_WEB_SEARCH_PROVIDER` / `DSH_WEB_FETCH_PROVIDER`。Provider 的释放函数会关闭准入、中止已接受的操作，并在其结束后完成。
- 原生 Provider 会收到发起调用的 `signal` 与 `appendEvent`。DeepSeek Provider 通过 `appendEvent` 记录 `web/deepseek-search-llm-request`，并在辅助模型请求离开进程之前等待其完成；Cordis 路径则通过发起方 Session 记录同一事件。
- DeepSeek Provider 在两条路径上通过同一个共享函数解析密钥：优先使用 credentials 服务，其次使用启动环境。其设置分区注册到原生 settings 服务，并实时更新。
- `@deepseek-ai/dsh-tool-web/native` 注册与 Cordis 工具相同的参数 schema、渲染文本、展示 meta 与提示词指引。schema 字面量随各自的注册 API 保留（原生工具使用标准 JSON Schema，Cordis 使用 dsh-tools DSL），沿用 tool-fs-search 的先例，并由测试保证二者一致。
- 随附的 `native-headless`、`native-web` 与 `native-tui` 组合会安装 `web`、`web-search-deepseek`、`web-fetch-http` 与 `tool-web`。

## 考虑过的替代方案

为原生路径重新实现这些工具，会使参数校验、查询合并、渲染与 DeepSeek 请求记录产生分叉，今后每个修复都需要提交两次。

在原生工具内部执行 `searchTimeoutMs` / `fetchTimeoutMs` 会复制工具调用超时守卫。截止时间仍由该守卫负责，与 Cordis 路径一致；原生工具只遵循调用信号。

## 后果

Cordis 路径的行为与输出保持不变。在原生工具调用超时守卫能够读取单个工具的预算之前，原生工具接受超时字段，但不会自行启动计时器。`native-sdk` 与 `native-acp` 组合暂不安装 web 相关行。
