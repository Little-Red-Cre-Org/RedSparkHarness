# Agent Note：标准 profile 名称创建 Native profile

Status: implemented

[English](2026-10-17-standard-native-profile-defaults.md) | 中文

## Problem

普通 profile 名称与随附的 `native-*` 名称分别选择同一 CLI surface 的平行实现。要求用户知道 runtime 专用名称，会让 Native 仍然是 opt-in，即使安装包闭包已经使用原生依赖。

## Decision

在 profile manifest 不存在时，`headless`、`web`、`sdk`、`acp` 和 `rsh` 会分别在请求的 profile 名称下创建 `native-headless`、`native-web`、`native-sdk`、`native-acp` 和 `native-tui` 组合。现有八个 `native-*` 别名仍可用，`sdk-minimal` 仍是 legacy 组合包 profile。

已有 `package.json` 仍负责选择 runtime。Native 初始化不会修改它；`profileRuntime` 按显式 Native 标记选择 Native，按 legacy 标记或组合包列表选择 legacy。Native Web 项目数据与 scheduler 数据库使用实际 profile 目录名称。

TypeScript 与 Python SDK 继续默认使用 `sdk`。TypeScript 源码 launcher 会解析已安装或构建后的 `dsh` 入口，不再添加 Cordis profile overlay；需要 legacy SDK 组合的调用方可用显式 `sdk` 组合包模板创建自定义 profile。

## Alternatives considered

**当名称成为标准 Native 名称时重写已有 profile。** 不采用，因为标准名称可能已经拥有用户管理的 legacy profile、依赖、patch、settings 与数据。

**把 SDK 默认值改为 `native-sdk`。** 不采用，因为 `sdk` 已是公开 SDK profile；新默认映射无需改变 SDK 选项即可选择 Native。

**新增更多别名或从剩余文件推断 runtime。** 不采用，因为 manifest 已提供显式 resolver，现有 `native-*` 别名也覆盖 runtime 专用选择。

## Consequences

新的标准 profile 使用 Native 配置，插件包管理命令会拒绝管理它们，并提示改为编辑 `rsh.profile.json` 安装项。已有 legacy manifest 继续经由 Cordis 启动。新的 legacy 应用组合需要自定义名称和 `--from-default-profile`；`sdk-minimal` 保持独立的 legacy runtime。

定向 CLI、包和 packed-consumer 检查覆盖名称映射、profile 保留、Native 路径与拒绝行为、无 Cordis 的 headless 启动以及已安装 SDK 声明。已安装声明检查使用严格 NodeNext 解析、消费者自身安装的 Node 类型和 ESNext disposable 声明。

新建 Desktop profile、精确 Desktop starter 转换、重置和开发 profile 会选择共享 Session 根目录下 canonical live generation 与保留删除 payload 中唯一的编码；空根使用 `none`，混合编码或旧式平铺 live 数据会在写入 profile 或停止 Host 前拒绝。普通升级时已有 Native Desktop profile 保留其显式编码。

Desktop 从 JSONL 包的 `./native-inspection` 入口执行这项预检；该入口不会加载持久化后端。

profile composer 通过 CLI 包已导出的 `./package.json` 读取随附 profile 名称；即使 Desktop 将 composer 打包进应用，CLI manifest 仍是模板名称的唯一来源。

LLM 根入口和 Native 入口直接导出消息构造器与 message.ts 独有类型；共享消息类型（包括 `MessageSourceMap`）只经 `types.ts` 导出一次，使生成声明保留单一且明确的来源。

Session expected 文件仍是作者维护的数据，本次默认变更不会重新生成它们。
