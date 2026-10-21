---
description: "Native profile 的 Code OSS Web Host 生命周期与工作区配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-code-oss

[English](README.md) | 中文

## Summary

在完整的 Code OSS 工作台中打开本地工作区，并使用其自带的 VS Code 扩展宿主。须单独安装兼容的 REH Web 运行时。Native profile 关闭时负责清理服务器及其子进程。

## Table of Contents

- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Configuration

`./native` 入口依赖 `subprocess`，提供 `ide`。所有配置字段均须显式填写：

| 字段 | 含义 |
|---|---|
| `runtimeDirectory` | Code OSS REH Web 发行版的绝对目录，包含 `node.exe`（Windows）或 `node`，以及 `out/server-main.js`。 |
| `workspaceDirectory` | 工作台打开的已有目录，须为绝对路径。 |
| `dataDirectory` | 服务器状态、用户设置和已安装扩展的绝对目录。 |
| `startupTimeoutMs` | 正数启动超时，单位为毫秒，最大 2147483647。 |
| `shutdownGraceMs` | 正数子进程终止宽限时间，单位为毫秒，最大 2147483647。 |
| `maxOutputBytes` | 每个输出流的保留上限，至少 1024 字节。 |

服务器监听 `127.0.0.1` 上的可用端口，使用随机连接令牌认证。`ide.url` 包含令牌和工作区路径，应按本地凭据处理。`ide.exited` 返回服务器退出码，进程失败时拒绝。NativeHost 销毁时等待服务器和扩展宿主子进程退出，随后删除临时令牌文件。设置和扩展会保留。服务器遥测被禁用；各扩展自行管理其遥测设置。

使用配置了 Open VSX 的发行版，例如 [VSCodium REH Web](https://github.com/VSCodium/vscodium/releases)，并保留其声明文件。发行版安装和升级由部署方负责。缺少运行时文件或工作区路径无效时，激活失败。不发布 invariant companion：就绪状态和进程所有权由同一个生命周期管理。

## Model Experience

### IDE lifecycle

#### What the model sees

无。Provider 不创建模型请求或 Session 事件。

#### Token effect

不增加模型请求 token。

#### KV Cache effect

不改变模型请求前缀。

## Known Limitations and Deferred Work

- 工作台运行在浏览器中，尚未提供 RSH Desktop 内嵌和 RSH 命令桥接。
- 兼容性取决于所选 Code OSS 版本、扩展宿主和扩展要求。Open VSX 和本地 VSIX 安装不保证兼容所有 VS Code 扩展；不包含 Microsoft 产品专属扩展。
- 扩展以本地用户权限执行。Native scope 不会对 Code OSS 扩展宿主进行沙箱隔离。
- 运行时须单独安装；本包不负责下载、打包或更新。

## Dev Note

无。
