# Agent Note: Native installers share the remaining capability owners

Status: implemented

[English](2026-11-16-native-capability-gaps.md) | 中文

## Problem

Native profile 已经能选择大多数宿主能力，但 SQLite 存储、不变量注册表、字符串替换编辑器、目录选择和 E2B 沙箱仍只能通过 Cordis 服务加载。若干 Native Web 入口还为了并不使用 Cordis 运行时的辅助函数去导入 Cordis 模块。在这些 owner 有 Native 安装器之前删除 Cordis，会丢掉仍可选择的行为。Cordis inspector 和 Agent Team 工具是另外的情况：前者读取 Cordis 上下文图，后者调用 Native 并未提供的团队服务。

## Decision

同一个包里的 Cordis 与 Native 安装器共用一个 owner。Native 的 `resolve` 校验 profile 行，并且不打开资源。Cordis 类仍是兼容适配器。

`@redspark/rsh-storage-sqlite` 注册同一个 SQLite 后端，并提供 `storageBackendsReady`。`@redspark/rsh-invariants` 用共享的包名准入规则提供 `invariants`。`@redspark/rsh-tool-str-replace-editor` 使用同一套替换、创建和过期版本检查。目录浏览、操作系统选择器与自适应选择器共享列表、平台对话框，以及启动时在本机对话框与浏览之间的选择。自适应选择器读取 Native 启动快照，不挂载 Cordis loader 入口。

`@redspark/rsh-e2b` 通过 `./owner` 上的 `E2BSandboxOwner` 提供 `e2b`。`@redspark/rsh-fs-e2b` 依赖 `e2b` 并提供 `fs`。`@redspark/rsh-subprocess-e2b` 依赖 `e2b`，并且只提供 `subprocess`。它不提供 `childConnection`。默认值仍是工作目录 `/home/user/workspace`、超时 `300000` 毫秒，以及子进程 `pollMs` 20。空的 `apiKey` 不会去读 `E2B_API_KEY`。

pet、通用设置、消息反馈、品牌、输入触发、会话触发货币、日程、客户端资源和 open-in-app 这些 Native Web 入口改为导入共享辅助函数，不再导入 Cordis 模块。

`@redspark/rsh-experimental-inspector` 仍是 Cordis 调试器，没有 Native 安装器。`@redspark/rsh-tool-agent-team` 在出现 Native 团队运行时之前留在 Cordis 上。[Agent Teams 包](2026-08-18-experimental-agent-teams-packages.zh.md) 仍拥有该功能。[Cordis 清理](../../proposed/architecture/2026-11-15-cordis-cleanup-keeps-legacy-writers.zh.md) 仍然不删除 Cordis、vendor 树或这些包。

## Alternatives considered

**给 inspector 一个报告插件元数据的 Native 入口。** 否决。inspector 读取的是 Cordis 上下文图。Native 诊断会是另一个工具。

**把 Agent Team 工具搬到 Native 文件系统和子进程服务上。** 否决。这些工具调用团队服务。Native 没有可供它们依赖的团队运行时。

**在这次变更里删除 Cordis 包。** 否决。旧 profile 和其余 Cordis 入口仍会加载它们。[Cordis 清理保留旧写入者](../../proposed/architecture/2026-11-15-cordis-cleanup-keeps-legacy-writers.zh.md) 仍安排这次删除的顺序。

## Consequences

Native profile 可以选择 SQLite、不变量、字符串替换编辑器、目录选择和 E2B 沙箱，而这些入口不再导入 Cordis。Cordis 插件保持相同的服务名、默认值和错误。Cordis 包仍安装在仓库里。Inspector 和 Agent Team 的行为不变。
