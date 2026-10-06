# Agent Note: 原生 Web profile 包与安装依赖

Status: implemented

English | [中文](2026-10-06-native-web-profile-installation.md)

## Problem

原生 Web Client 包由 `dsh.native` profile 行选择；旧浏览器模块表则通过 `./client` 导出加载 `dsh.client` 行。把仅供原生 profile 使用的包当作动态 Client 模块，会凭空引入没有消费者的加载入口；若已发布声明引用的 workspace 类型仍只在开发依赖中，独立消费者也无法解析这些声明。

## Decision

显式 `nativeProfileClientDirectories` 集合将 `native-session` 和 `native-application` 分类为原生 profile Client 包。`verify-client-packages` 仅在包选择原生 Client target、导出 `./native` 且没有声明 `dsh.client` 或 `staticLinked` 预设时接受该模式；`verify-native-dependencies` 验证所选 native manifest 及其源码入口。旧模块表仍要求真实的 `dsh.client` 行和 `./client` 导出。

发布不变量扫描器只跟踪从规范 `tsdown.client.ts` 模块导入的具名构建 helper。它从 `clientOnly` 和 `staticLinkedLeaf` wrapper 读取字面产物路径列表；同名本地 helper 不能替包声明产物文件。可选依赖源码扫描器只在本地 CSS 导入引用的资源文件确实存在时接受该导入。

SDK Loader fixture 会从 `ctx.inject()` 回调返回异步的 `tool-subagent` 兼容安装器。Cordis 会在报告 Agent 范围插件就绪前等待此 Promise；启动失败时，它会回收已注册的 effects。丢弃该 Promise 会让启动与延迟导入竞态，并使插件 fiber 无法处理导入拒绝。

当会话持久化尚未挂载时，由 Loader 管理的声明式新建会等待公开的 `loader.await()`。配置树结算后，若选中了 Provider，就先取得写句柄再发布 Agent；组合成功但没有 Provider 时仍使用内存，组合失败则报告启动失败。省略 `sessionId` 仍会生成新的随机身份，提供稳定 ID 则继续执行恢复或新建。没有 Loader 的直接 Context 组合仍遵循原有挂载顺序。

`native-web-assets` 读取每个选中的 profile 行，验证 `dsh.native`，并解析它的 `./native` 导出。`dev-web` 将这些包的构建与 Cordis 模块表清单及静态链接 shell 库清单分开。

已发布声明文件引用的 workspace 包列在 `publishedTypeDependencies` 中，并作为普通依赖安装。安装依赖会闭合其声明；只有原生 profile 选中后才会激活依赖的 `NativePlugin`。共享 Client 运行时值仍通过 `sharedClientRuntimePeers` 声明为 peer；依赖门禁要求选定 Client 源文件中存在真实值导入，并要求 manifest 声明对应 peer，因此仅类型导入不会建立共享身份。

## Alternatives considered

保留 `dsh.client` 并添加 `./client` 导出不可取，因为这些包没有旧模块表消费者；该入口会暴露无关的加载协议。删除 `dsh.client` 却不增加独立 Client 模式不可取，因为包模式门禁会将原生包判为不受支持。声明专用关系使用 peer 也不可取，因为这些类型提供方不需要与消费者共享运行时值身份。将 Client 运行时导入归为 Host 导出身份也不可取，因为 Host 中继清单必须只描述 Host 消费者。

根据 helper 的名称推断构建配置不可取，因为本地伪装函数或无关模块不能扩大已发布产物。忽略无法解析的 CSS 导入也不可取，因为缺失的本地资源会使浏览器产物不完整。

## Consequences

`native-session` 将其公开声明提供方 `native-runtime`、`client-connection`、`native-model-selection`、`agent-presets` 和 `brand` 声明为 dependencies。`native-application` 将 `native-runtime` 声明为已发布声明的 dependency，并将 `client-native-session` 声明为共享 Client peer 与开发依赖，因为 Settings 页面在运行时导入 `NativeSessionRpcError`，并必须与所选 Consumer 解析到同一个构造器。两个包仍由 `dsh.native` 选择；`client-connection` Provider 的可选 Cordis peer 不会让原生 installer 必须依赖 Cordis。

现有[profile fallback 决策](2026-09-25-profile-module-fallback-optional-dependencies.zh.md)规定已安装可选兼容包的发现方式；本说明记录原生 Web 包已发布声明的依赖闭包。

## Verification

新的 consumer 在 `autoInstallPeers: true` 且没有 workspace packages 时安装了五个选定原生包及其打包依赖闭包。strict NodeNext 类型检查在 `skipLibCheck: false` 下通过；Node 导入四个 Host native 入口，Client 入口单独通过类型检查。Cordis 未安装，也无法解析。Pnpm 报告四个原生包的可选 peer 查询返回 registry 404；这些包仍通过必需依赖路径从本地 tarball 成功解析。

配对的包说明见 [native-session](../../../../rsh/Programs/Web/client/native-session/README.zh.md) 与 [native-application](../../../../rsh/Programs/Web/client/native-application/README.zh.md)。
