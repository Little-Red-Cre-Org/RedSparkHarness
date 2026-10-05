# Agent Note: 文件系统兼容使用已验证的 Cordis 版本

Status: implemented

English | [中文](2026-10-05-compatibility-filesystem-version-support.md)

## Problem

接受所有以 `4.` 开头的字符串，会在插件激活前接受非法 manifest 和未验证的 Cordis 版本。适配器允许列表也需要明确记录所需服务、配置及生命周期支持。

## Decision

可选的文件系统兼容 runtime 只接受 Cordis 4.0.2，即固定的 vendor 版本。其 README 拥有同版本 RSH 包的首批 Host 适配器矩阵。各适配器保留既有配置校验和原生清理所有权。不支持 Loader 配置、HMR 和 Client 适配器。

## Alternatives considered

主版本范围会声明超出已验证 vendor 源码的兼容性。增加用户覆盖选项会在没有验证时削弱激活检查。

## Consequences

非法、预发布及其他版本 manifest 在创建 Context 前拒绝。更新支持版本时必须修改固定版本并验证受影响适配器集合。此变更不修改 vendor 源码、默认 profile 或 Session 格式。
