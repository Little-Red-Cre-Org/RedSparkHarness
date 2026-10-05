# Agent Note: 原生 Web profile 包与安装依赖

Status: implemented

English | [中文](2026-10-06-native-web-profile-installation.md)

## Problem

原生 Web Client 包由 `dsh.native` profile 行选择；旧浏览器模块表则通过 `./client` 导出加载 `dsh.client` 行。把仅供原生 profile 使用的包当作动态 Client 模块，会凭空引入没有消费者的加载入口；若已发布声明引用的 workspace 类型仍只在开发依赖中，独立消费者也无法解析这些声明。

## Decision

显式 `nativeProfileClientDirectories` 集合将 `native-session` 和 `native-application` 分类为原生 profile Client 包。`verify-client-packages` 仅在包选择原生 Client target、导出 `./native` 且没有声明 `dsh.client` 或 `staticLinked` 预设时接受该模式；`verify-native-dependencies` 验证所选 native manifest 及其源码入口。旧模块表仍要求真实的 `dsh.client` 行和 `./client` 导出。

`native-web-assets` 读取每个选中的 profile 行，验证 `dsh.native`，并解析它的 `./native` 导出。`dev-web` 将这些包的构建与 Cordis 模块表清单及静态链接 shell 库清单分开。

已发布声明文件引用的 workspace 包列在 `publishedTypeDependencies` 中，并作为普通依赖安装。安装依赖会闭合其声明；只有原生 profile 选中后才会激活依赖的 `NativePlugin`。共享 Client 运行时值仍通过 `sharedClientRuntimePeers` 声明为 peer；依赖门禁要求选定 Client 源文件中存在真实值导入，并要求 manifest 声明对应 peer，因此仅类型导入不会建立共享身份。

## Alternatives considered

保留 `dsh.client` 并添加 `./client` 导出不可取，因为这些包没有旧模块表消费者；该入口会暴露无关的加载协议。删除 `dsh.client` 却不增加独立 Client 模式不可取，因为包模式门禁会将原生包判为不受支持。声明专用关系使用 peer 也不可取，因为这些类型提供方不需要与消费者共享运行时值身份。将 Client 运行时导入归为 Host 导出身份也不可取，因为 Host 中继清单必须只描述 Host 消费者。

## Consequences

`native-session` 将其公开声明提供方 `native-runtime`、`client-connection`、`native-model-selection`、`agent-presets` 和 `brand` 声明为 dependencies。`native-application` 将 `native-runtime` 与 `client-native-session` 声明为 dependencies。两个包仍由 `dsh.native` 选择；`client-connection` Provider 的可选 Cordis peer 不会让原生 installer 必须依赖 Cordis。

现有[profile fallback 决策](2026-09-25-profile-module-fallback-optional-dependencies.zh.md)规定已安装可选兼容包的发现方式；本说明记录原生 Web 包已发布声明的依赖闭包。

## Verification

仅直接依赖 `native-application` 的 packed consumer 在 `autoInstallPeers: true` 下完成安装，并以 strict NodeNext、`skipLibCheck: false` 编译公开导入；运行时成功导入 root 与 `./native` 入口，且未安装或解析到 Cordis。

配对的包说明见 [native-session](../../../../rsh/Programs/Web/client/native-session/README.zh.md) 与 [native-application](../../../../rsh/Programs/Web/client/native-application/README.zh.md)。
