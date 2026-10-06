# Agent Note: 文件系统兼容使用已验证的 Cordis 版本

Status: implemented

English | [中文](2026-10-05-compatibility-filesystem-version-support.md)

## Problem

接受所有以 `4.` 开头的字符串，会在插件激活前接受非法 manifest 和未验证的 Cordis 版本。适配器允许列表也需要明确记录所需服务、配置及生命周期支持。

## Decision

可选的文件系统兼容 runtime 只接受 Cordis 4.0.2 和 Loader 1.0.3。统一支持记录固定四个文件系统 DSH 包，以及共享的 `dsh-tools` 和 `dsh-system-prompt` Cordis 插件，版本均为 0.1.5-rc.2。文件系统包必须声明记录中的 DSH runtime API、角色和能力；共享 Cordis 插件没有 `dsh.runtime` 声明，因此 runtime 会检查其已安装包名和版本，使用 RSH `adapter` 描述符，并在启动后要求其提供声明的服务。选定插件以共享 Loader entry 运行。配置更新、启用、停用和移除会先排空原生工具、进行中的提示词组装、事件监听器和已接收的调用，再执行 Loader 操作；原生 profile 替换是独立操作。不支持模块代码 HMR、任意插件、旧应用 bundle 和 Client adapter。详见[原生兼容 Loader entry 生命周期决策](2026-10-06-native-compatibility-loader-entry-lifecycle.zh.md)。

## Alternatives considered

主版本范围会声明超出已验证 vendor 源码的兼容性。增加用户覆盖选项会在没有验证时削弱激活检查。

## Consequences

非法、预发布及其他版本 manifest 在创建 Context 前拒绝。更新支持版本时必须修改固定版本并验证受影响适配器集合。Loader entry 配置不会创建旧 Agent loop 或 Session writer。此决策不修改 vendor 源码、默认 profile 或 Session 格式。
