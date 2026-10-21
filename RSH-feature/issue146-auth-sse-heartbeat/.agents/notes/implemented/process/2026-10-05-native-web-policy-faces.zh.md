# Agent Note: 原生 Web 编译面与发布入口

Status: implemented

[English](2026-10-05-native-web-policy-faces.md) | 中文

## Problem

四个既有 Web 包已发布原生入口，但未列入原生 owner 和发布文件表。资源构建器的 native-client 文件名指明其输出，不表示执行面：实现运行于 Host。

## Decision

[原生 Web Host](../../../../rsh/Programs/Web/host/native-web-host/README.zh.md) 与[资源构建器](../../../../rsh/Programs/Web/host/native-web-assets/README.zh.md)属于纯 Host owner。[显式编译目标](../../../../rsh/Scripts/native-package-policy.ts)让 Node 和构建器源码保持在 Host 面。[Connection](../../../../rsh/Programs/Web/client/connection/README.zh.md) 与 [UI Renderer](../../../../rsh/Programs/Web/client/ui-renderer/README.zh.md) 保留兼容入口，并按既有原生 Client installer 描述登记。Connection 的 native-host、native-http-bridge 与资源构建器的 native-client 出口按实际 Host 面检查。

[发布白名单](../../../../rsh/Scripts/check-workspace-constraints.ts)仅接受这四个 manifest 已列出的原生 bundle 与 Connection 传输共享文件。每个登记的公开入口仍必须有真实源码导出；源码扫描继续拒绝 Cordis 和缺失引用。

缺失 exports 的 manifest 返回缺失源码诊断，不抛出索引 TypeError，也不被当作有效入口。

## Alternatives considered

按 Client 扫描资源构建器会要求不存在的 Client 编译 owner，并错误分类 Node 依赖。为纯 Host 包增加 Cordis peer 会在没有运行时需要的情况下改变安装要求。

复制未来 policy 名册会接纳无关包，让此修正依赖尚未发布的实现。本次只包含当前树已存在的 owner。

## Consequences

这些分类保持运行时行为和兼容导入，不引入 profile 选择、默认切换或依赖席位。编译面与发布检查仍区别于产品执行证据。
