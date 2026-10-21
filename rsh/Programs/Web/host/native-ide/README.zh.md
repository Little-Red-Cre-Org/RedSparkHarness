---
description: "通过 dsh profile 启动原生 Code OSS IDE。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-ide

[English](README.md) | 中文

## Summary

使用 `dsh --profile native-ide` 启动本地浏览器 IDE。Profile 输出带认证信息的工作区 URL，并等待关闭。Code OSS 运行时须单独安装。

## Table of Contents

- [Launch](#launch)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Launch

将 Code OSS REH Web 发行版安装到 `$DSH_HOME/ide/runtime`，使其内置 Node 可执行文件和 `out/server-main.js` 直接位于该目录下。在要编辑的工作区中运行 `pnpm dsh --profile native-ide`，用浏览器打开输出的本地 URL。无需模型凭据。

首次运行会写入 `$DSH_HOME/profiles/native-ide/rsh.profile.json`。工作区取自首次调用时的当前目录；选择其他文件夹时，修改 profile 中的 `workspaceDirectory`。Profile 同时选择运行时位置、持久化数据和进程超时，详见 [provider 配置](../../../../Modules/Official/ide/ide-code-oss/README.zh.md)。

Application 不接受任务参数或插件配置。它等待取消或服务器退出，由 profile 负责清理。不发布 invariant companion，因为生命周期和退出状态来自所选 IDE provider。

## Model Experience

### IDE application

#### What the model sees

无。该 profile 不启动 agent（智能体）或 Session。

#### Token effect

不发出模型请求。

#### KV Cache effect

不涉及模型缓存。

## Known Limitations and Deferred Work

- 这是浏览器 IDE profile，不会在 Desktop application 中添加 IDE 面板，也不会将编辑器命令连接至 RSH agent。
- 发行版须手动安装和更新。npm 包不包含运行时。

## Dev Note

无。
