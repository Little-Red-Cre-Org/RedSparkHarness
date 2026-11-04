---
description: "通过外部 Code OSS 工作台提供原生 IDE 集成。"
kind: "package-group"
---

# ide/ — Native IDE

[English](README.md) | 中文

## Summary

[ide-code-oss](ide-code-oss/README.zh.md) 通过 Native 插件系统提供 Code OSS 工作区和扩展宿主。[native-ide application](../../../Programs/Web/host/native-ide/README.zh.md) 通过受支持的 CLI（命令行界面）profile 使用它。

## Ownership

Provider 通过 [subprocess 子系统](../../../Docs/subsystems/subprocess.zh.md) 持有本地服务器进程及其子进程。Code OSS 负责编辑、终端、扩展安装与激活。RSH 不会将 VS Code 扩展加载进 NativeHost。
