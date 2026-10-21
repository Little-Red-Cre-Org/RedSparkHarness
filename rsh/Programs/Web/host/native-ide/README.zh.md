---
description: "通过 dsh profile 启动原生 Code OSS IDE。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-ide

[English](README.md) | 中文

## 概述

本包通过 Native profile 管理 Code OSS 工作区及其进程生命周期。

## 目录

- [Launch](#launch)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Launch

将 Code OSS REH Web 发行版安装到 `$DSH_HOME/ide/runtime`，使其内置 Node 可执行文件和 `out/server-main.js` 直接位于该目录下。在要编辑的工作区中运行 `pnpm dsh --profile native-ide`，用浏览器打开输出的本地 URL。无需模型凭据。

首次运行会写入 `$DSH_HOME/profiles/native-ide/rsh.profile.json`。工作区取自首次调用时的当前目录；选择其他文件夹时，修改 profile 中的 `workspaceDirectory`。Profile 同时选择运行时位置、持久化数据和进程超时，详见 [provider 配置](../../../../Modules/Official/ide/ide-code-oss/README.zh.md)。

Application 不接受任务参数或插件配置。它等待取消或服务器退出，由 profile 负责清理。不发布 invariant companion，因为生命周期和退出状态来自所选 IDE provider。

## Model Experience

无，因为本包只管理 IDE 生命周期，不创建模型输入。

#### KV Cache effect

不改变模型请求前缀。

## Known Limitations and Deferred Work

- 此 profile 持有 IDE 服务器。[Desktop](../../../Desktop/README.zh.md) 负责内嵌对话适配；独立浏览器启动不连接 RSH Agent。
- 发行版须手动安装和更新。npm 包不包含运行时。

<a id="dev-note"></a>
### 开发备注

进程与就绪状态由同一个生命周期管理；不发布独立 invariant companion。
