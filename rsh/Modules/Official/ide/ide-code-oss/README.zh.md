---
description: "Native profile 的 Code OSS Web Host 生命周期与工作区配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-ide-code-oss

[English](README.md) | 中文

## 概述

本包通过 Native profile 管理 Code OSS 工作区及其进程生命周期。

## 目录

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
| `builtinExtension` | 可选的本地 VSIX 绝对路径，在服务器启动前安装；Desktop 提供随应用发布的工作台适配扩展。 |
| `languagePack` | 可选的 publisher.extension 标识，在启动前通过上游配置的扩展市场安装；Desktop 在选用简体中文时提供对应语言包。 |
| `startupTimeoutMs` | 安装及服务器启动各阶段的正数超时，单位为毫秒，最大 2147483647。 |
| `shutdownGraceMs` | 正数子进程终止宽限时间，单位为毫秒，最大 2147483647。 |
| `maxOutputBytes` | 每个输出流的保留上限，至少 1024 字节。 |

provider 等待 VSIX 安装完成后才启动服务器，使首次扩展扫描包含适配器，并在工作区重载后继续可用。安装失败时不启动服务器。服务器监听 `127.0.0.1`，使用随机连接令牌认证。`ide.url` 包含令牌和工作区路径，应按本地凭据处理。`ide.exited` 返回服务器退出码，进程失败时拒绝。NativeHost 销毁时等待服务器和扩展宿主子进程退出，随后删除临时令牌文件。设置和扩展会保留。服务器遥测被禁用；各扩展自行管理其遥测设置。

使用配置了 Open VSX 的发行版，例如 [VSCodium REH Web](https://github.com/VSCodium/vscodium/releases)，并保留其声明文件。发行版安装和升级由部署方负责。缺少运行时文件或工作区路径无效时，激活失败。不发布 invariant companion：就绪状态和进程所有权由同一个生命周期管理。

服务器首次启动时绑定可用端口，并记录到 `dataDirectory/server-port`；后续启动必须使用该端口。端口被占用或端口记录无效时，激活失败，不会更换浏览器 origin 而失去已有工作台状态。每个数据目录由一个运行中的服务器持有。连接令牌仍为每次启动独有，并在退出后删除。

每个规范项目路径对应数据目录下持久保存的 `workspaces/<sha256>/RedSpark.code-workspace`，通过上游 `workspace` URL 参数打开。Windows 路径在计算键时转换为小写。首次文件包含选定文件夹；后续文件夹和工作区设置的修改由 Code OSS 管理，provider 会保留这些修改。稳定的 origin 和工作区 URI 使上游信任决定及编辑器存储可跨重启保留。支持多根目录可避免首次文件夹切换时工作区转换触发保存操作；项目文件仍位于原目录。

## Model Experience

无，因为本包只管理 IDE 生命周期，不创建模型输入。

#### KV Cache effect

不改变模型请求前缀。

## Known Limitations and Deferred Work

- 独立启动会打开浏览器；[Desktop](../../../../Programs/Desktop/README.zh.md) 负责内嵌工作台和对话适配。
- 兼容性取决于所选 Code OSS 版本、扩展宿主和扩展要求。Open VSX 和本地 VSIX 安装不保证兼容所有 VS Code 扩展；不包含 Microsoft 产品专属扩展。
- 扩展以本地用户权限执行。Native scope 不会对 Code OSS 扩展宿主进行沙箱隔离。
- 运行时须单独安装；本包不负责下载、打包或更新。

<a id="dev-note"></a>
### 开发备注

进程与就绪状态由同一个生命周期管理；不发布独立 invariant companion。
