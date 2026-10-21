# Agent Note: 原生兼容通过 Loader entry 管理选定的 Cordis 插件

Status: implemented

[English](2026-10-06-native-compatibility-loader-entry-lifecycle.md) | 中文

## Problem

Host 文件系统兼容适配器需要由 Loader 管理配置更新和 entry 移除，同时避免替换 Native 安装，也避免在 Cordis teardown 期间暴露过期的原生工具、提示段落或文件系统监听器。

## Decision

`compat-dsh-runtime` 为选定的 Native 安装创建一个 Cordis Context，安装 `RshPluginHost` 与 vendor Loader，并通过 Loader 挂载受支持的 entry。支持记录固定 Cordis 4.0.2、Loader 1.0.3、四个版本为 0.1.5-rc.2 的文件系统 DSH 包，以及同为 0.1.5-rc.2 的共享 `dsh-tools` 与 `dsh-system-prompt` Cordis 插件。文件系统 DSH 包必须匹配其已安装包名、版本、runtime API、角色与能力元数据。共享 Cordis 插件没有 `dsh.runtime` 声明；系统会从已安装 manifest 检查包名和版本，其 RSH adapter 描述符使用 API 1、`adapter` 角色和 `dsh-compatibility` 能力，并要求启动后提供 `tools` 与 `systemPrompt` 服务。

Loader entry 配置更新、启用、停用和移除共用一个串行操作队列。每次操作前，已注册的 Native participant 会撤销其贡献并等待已接收的工具调用、提示词组装和事件监听器排空。Loader 操作完成后，participant 根据当前启用的 entry 和服务重建资源。激活失败时，系统会尝试在运行队列中的下一项前移除部分 entry；如果 participant 阻止清理，失败的 mount 会继续被跟踪，以便 participant 恢复后由 disposer 重试。原生应用仍然是 Agent 执行、工具结果日志和 Session 持久化的唯一所有者。Native profile 变化由 `NativeHost.replace` 替换整个安装，与 Loader entry 更新相互独立。模块代码 HMR、任意插件、旧应用 bundle 和 Client 兼容仍不受支持。

## Alternatives considered

**保留直接的 `Context.plugin()` 挂载：**不采用，因为直接 Fiber 挂载不会成为拥有 Loader 配置更新和移除语义的 Loader entry。

**每次旧配置变更都替换整个 Native 安装：**不采用，因为 Loader 已经拥有 Cordis entry 配置和生命周期；重启 Native 安装会把局部 entry 变更扩大为无关原生服务替换。

**将 Loader 配置支持描述成模块代码 HMR：**不采用，因为此组合注册的是内联且受支持的 entry，并未建立 Native bridge 代码监听或模块替换契约。

## Consequences

选定的 Cordis entry 可以更新和移除，同时保留同一个 Native Agent 和 Session 所有者。工具 schema 和提示段落会在对应 entry 变更前撤销，并在 Loader 修改 entry 前排空已接收的调用和提示词组装；文件系统策略 bridge 会在策略 entry 变更前排空其 Native 监听器。实时文件系统服务代理会在配置更新后解析当前 Cordis Provider，并在 entry 停用或移除后失败。精确包版本限制了可接受的集成版本；升级需要修改支持记录并定向验证生命周期。

## Verification

定向 Native bridge 运行覆盖启动回滚、participant 激活失败与 disposer 重试、失败激活后的排队更新、配置更新、启用、停用、移除、工具调用与提示词组装排空、提示和 schema 重建、文件系统观察转发以及一条持久化工具结果。以下命令通过（5 个文件、18 个测试）：`pnpm exec vitest run --config vitest.config.ts rsh/Compatibility/DSH/bridge/compat-dsh-runtime/tests/native.spec.ts rsh/Compatibility/DSH/bridge/compat-fs-local/tests/native.spec.ts rsh/Compatibility/DSH/bridge/compat-fs-policy/tests/native.spec.ts rsh/Compatibility/DSH/bridge/compat-fs-sandbox/tests/native.spec.ts rsh/Compatibility/DSH/bridge/compat-tool-fs/tests/native.spec.ts --reporter dot`；当前执行日志为 `output/p4-compat-loader-lifecycle/native-bridge-focused-after-recovery-attempt-3.log`。

## Related

- [文件系统兼容版本支持](2026-10-05-compatibility-filesystem-version-support.zh.md)
- [原生兼容 bridge](2026-09-22-native-compatibility-bridge.zh.md)
- [兼容 runtime README](../../../../rsh/Compatibility/DSH/bridge/compat-dsh-runtime/README.zh.md)
