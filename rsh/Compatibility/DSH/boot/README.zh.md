---
description: "boot 包组：dsh app bin 如何启动——环境加载、profile 与 patch 层、清晰的启动失败信息，以及由应用持有的命令行。"
kind: "package-group"
---

# boot/：共享的 app bin 启动粘合层

[English](README.md) | 中文

## 概述

boot 组提供 dsh 应用启动所需的能力：`app-boot` 把 `cordis.yml` 连同环境与 patch 层变成运行中的应用，并给出清晰的失败信息；`cmdline` 让应用持有自己的命令行 flag 与 `--help`。私有的 `desktop-host-compatibility` 包只会在显式选择的 Desktop 兼容装配中启动旧 Cordis profile。每个包的 README 定义其包级约定；Desktop 文档负责兼容装配与 profile 要求。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`app-boot`](app-boot/README.zh.md) | 从 `cordis.yml` 启动 dsh 应用：加载 `.env`、应用 profile 与 patch 层，并清晰报告启动失败 | （供各 bin 使用的库） |
| [`cmdline`](cmdline/README.zh.md) | 让应用持有自己的 flag、`--help` 与退出码；启动器自身 flag 之后的一切原样传入 | `cmdlineArgs`、`appExit` |
| [`desktop-host-compatibility`](desktop-host-compatibility/README.zh.md) | 在显式选择的 Desktop 兼容装配中启动旧 Cordis profile | 私有 Desktop 运行时 |

<a id="related-documentation"></a>
## 相关文档

- [dsh 应用](../../../Programs/CLI/README.zh.md)——在其启动序列中使用这些 helper 的 `dsh` bin。
- [Desktop](../../../Programs/Desktop/README.zh.md)——发行装配选择与支持的 profile runtime。
- [Profile 组合包](../bundle/README.zh.md)——可由 `dsh --profile` 组合挂载的可安装 patch 层。
- [dsh-home-paths](../../../Core/util/home-paths/README.zh.md)——两个包都依赖的 harness home 解析器。
- [dsh-cmdline](cmdline/README.zh.md)——flag 家族如何由应用持有而非启动器。

<a id="dev-note"></a>
## 开发备注

无。
