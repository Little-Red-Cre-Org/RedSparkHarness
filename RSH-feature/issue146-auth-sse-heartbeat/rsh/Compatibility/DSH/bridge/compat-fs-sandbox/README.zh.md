---
description: "原生 profile 只能在显式原生逐 Session 策略下使用旧 sandbox 文件系统。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-fs-sandbox

[English](README.md) | 中文

## 概述

`dsh-compat-fs-sandbox` 为原生 profile 选择现有 sandboxing 文件系统。它要求 `sandboxPolicy`，将该策略适配进共享 Cordis Context，并通过跟随 Loader Provider 替换的实时代理提供唯一原生 `fs` 服务。被拒绝的变更仍然被拒绝，此 bridge 绝不回退到裸本地存储。

## 目录

- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="configuration"></a>
## 配置

配置采用 `dsh-fs-sandbox` 接受的本地后端配置。兼容 runtime 会按[支持矩阵](../compat-dsh-runtime/README.zh.md#supported-adapter-set)校验已安装包。更新 Loader entry 会替换实时原生代理后的 Provider；停用和移除会等待 Loader 清理，之后服务访问会以不可用错误失败。profile 还必须以显式 mode 和绝对根目录安装 `dsh-native-sandbox-policy`。缺少策略、不支持的配置或重复 `fs` Provider 都会拒绝激活。

<a id="model-experience"></a>
## 模型体验

bridge 不直接发送文本。工具把被拒绝的文件系统结果变为面向模型的错误文本，其原生应用记录该结果。

#### KV Cache 影响

不添加或重排请求内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 文件系统限制仍采用旧后端接受的 containment 模型，不是内核隔离。
- 原生策略在此阶段不投影 Session mode 覆盖。

不发布 invariant companion，因为选定策略和文件系统 Provider 具有一个所属安装生命周期。

<a id="dev-note"></a>
### 开发备注

无。
