# Agent Note: Desktop-only retires the browser Web deployment

Status: implemented

[English](2026-11-21-desktop-only-retires-browser-web.md) | 中文

## Problem

Desktop 曾支持两套装配：默认的 Native Host，以及启动 Cordis bundle 的兼容 Host。CLI 还提供 `web` 命令和随附的 `web` profile，用于独立浏览器部署。保留两条产品路径意味着每次 Desktop 改动都必须维护一个 Cordis 启动粘合包、旧版插件管理器和一条没有受支持用户流程的浏览器启动面。这条兼容分支正是 Cordis 无法从产品中移除的主要原因。

## Decision

Desktop 只发布一个 Native 装配。`desktop-host-compatibility` 已删除；`packages/prepare-package-set.ts` 与 `package-target.ts` 拒绝非 `native` 的 `--assembly` 值；`RSH_DESKTOP_ASSEMBLY` 拒绝非 Native 值；已存在的 `assembly: compatibility` 运行时描述符会失败，并指向 `rsh/Docs/native-config-migration.md`。`DesktopHost` 遇到非 Native profile 时返回同一迁移指引，不再导入兼容运行时。

Desktop 项目管理器只保留 Native 模块管理。旧版插件的 list、add、update、remove、disable-all、`supportsLegacyPluginManagement` 与 profile bundle 写入均已移除；非 Native profile 会抛出已退役错误；重置始终创建 Native profile；新建组合请求 `native-web` Client 模板。

CLI 退役 `web` 命令别名，并拒绝 `--profile web` 与 `--from-default-profile web`。其 Native profile 模板只列出 `native-web`。启动旧入口的 CLI 测试已删除；Native Web 启动与授权覆盖位于 Web application e2e 套件和 Native session-controller 授权测试。GitHub webhook 的真实 HTTP 端到端用例没有替代，因为它驱动的是已退役服务器；webhook handler 与组合套件仍在。

浏览器渲染层及其支撑的 Native host 包保留：`rsh/Programs/Web/client/**`、`client/web` 下的 Native boot 入口、`host/native-web-assets`、`host/native-web-session-controller`、`native-web` profile、`rsh-web-frontend` 的构建产物，以及现有浏览器 e2e lane 使用的兼容 bundle 与 `profile: web` 快照。删除这些需要后续的旧 Web 退役，因为快照仍会启动该组合，而若干 Native 缺口（subagent conversation/interrupt RPC、session fork、skill tool 行、settings 文档、右侧栏多文档标签）会阻止先迁移它们。

`tsconfig.host.json` 引用 Web frontend 项目，因为 `verify-publish-payload` 会读取 `PLATFORM_MODULES` 与 `PRELOADED_CLIENT_EXTERNALS`；该引用把值解析为声明文件，而不会把 Client 源码加入 Host 程序。

## Alternatives considered

**在本次改动中删除全部 Web 包：** 保留的 `profile: web` 快照与兼容 bundle 链仍会启动 `rsh-web-compatibility`、`host-webserver` 和 `host/frontend-static`。现在删除会在 Native 替代品出现前移除覆盖。

**用开关隐藏兼容装配：** 隐藏回退会让 Cordis 启动粘合层与插件管理器继续存活，用户还会从同一发行版得到两套 Desktop 运行时。

**现在把 Web 快照迁移到 Native：** 若干 Native RPC 与 UI 缺口会让 subagent conversation、interrupt、fork、skills、settings 文档和右侧栏多文档标签失去覆盖。

**让 Desktop 带警告接受自定义 Cordis profile：** 静默接受会保留旧 profile 格式，并阻碍后续所有 Cordis 删除。迁移错误会指出受支持的替代方式。

## Consequences

旧 Desktop profile 现在会带迁移指引明确失败，而不是启动兼容 Host。旧版插件窗口、恢复动作、preload 桥接与 IPC 处理器均已移除；Native 模块管理是唯一的包操作面。Desktop 打包始终生成 Native 目标布局，并始终携带 `@redspark/rsh` 与 `@redspark/rsh-desktop-host`。

独立浏览器部署不再有受支持的启动路径，但其 Cordis bundle、服务器包和快照仍为浏览器 e2e lane 保留。下一步必须退役该 lane，迁移或记录全部 32 个 `profile: web` 场景，并移除 `rsh-web-app`、`rsh-base`、Typert Remote Web 面以及剩余的 Cordis Web 入口。

已知 Native 缺口是产品缺口，而不是隐藏回退：subagent conversation/interrupt RPC、session fork、skill tool 行、settings 打开文档路由，以及右侧栏多文档标签。在这些能力存在之前，覆盖它们的快照继续留在旧组合上。

## Verification

`pnpm run typecheck`、`pnpm run lint` 与 `pnpm run doc-sync` 通过。15 个聚焦 Vitest 文件通过——177 个测试，1 个跳过——覆盖 Native 包选择、退役装配拒绝、Native profile 链接、启动文案、退役的 CLI 别名，以及 package-set、runtime-closure 与 build-output 门禁。与已删 legacy 插件套件同处一个 describe 块的 Native project-manager 测试已用 `setupNative()` 恢复。`pnpm run test` 报告 175 个失败，而未改动的 `ad37307b34` 基线为 183 个；两次运行的用例名对比显示本次改动涉及的测试均未失败，其余失败集合保持不变。Desktop 打包准备无法在此 Linux 主机运行（`unsupported build host linux-x64`），因此打包 smoke 交由 CI。
