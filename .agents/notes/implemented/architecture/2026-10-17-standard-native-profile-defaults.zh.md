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

定向 CLI、包和 packed-consumer 检查覆盖名称映射、已有 profile 保留、Native Web 数据路径、Native 插件拒绝、无 Cordis 的 headless 启动以及已安装 SDK 声明路径。Session expected 文件仍是作者维护的数据，本次默认变更不会重新生成它们。
