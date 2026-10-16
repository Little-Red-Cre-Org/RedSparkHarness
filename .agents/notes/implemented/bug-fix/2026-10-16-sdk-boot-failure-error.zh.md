# Agent Note：SDK 启动失败错误

Status: implemented

[English](2026-10-16-sdk-boot-failure-error.md) | 中文

## 问题

SDK JSON-RPC 服务器插件运行在 profile 的 Loader 插件树中。当另一个配置项在启动期间失败时（例如两个文件系统提供方都注册服务 `fs`），Loader 会移除失败的配置项并回滚插件树，从而 dispose 服务器的上下文。`initialize` 的就绪等待仍然正常结束，于是处理函数在已 dispose 的上下文上创建 effect，SDK 客户端收到的是 `cannot create effect on inactive context`，而不是启动失败本身。

## 决策

在 `initialize` 响应之前，[`dsh-sdk-jsonrpc-server`](../../../../rsh/Programs/SDK/packages/server/README.zh.md) 会自行等待待处理的 Loader 任务并保留第一个拒绝，因为失败的配置项会在回滚将其移除之前拒绝自己的任务；最后的 `loader.await()` 会报告在配置项任务完成之后才失败的 fiber，例如延迟注入之后的失败。Loader 把每个配置项失败包装为 `failed to <stage> loader entry <id> (<name>): ...`，并以内部错误作为 `cause`；服务器沿这条链（遇到聚合错误时取其第一个错误）找到最深的包装错误。失败之后，`initialize` 以及之后处理的任何请求都会以 `SDK runtime failed to start: loader entry "<id>" (<plugin>) failed: <ErrorType>[: service "<name>" is already provided by another plugin]; see the runtime stderr log for details` 拒绝。

该消息只包含配置项 id、插件名、错误类型以及可识别的 Cordis 重复服务注册规则。它从不包含插件的错误消息、堆栈或 cause，因为这些内容可能带有配置值；app-boot 仍会把完整错误打印到 stderr。

## 考虑过的替代方案

**由 app-boot 通过启动器服务上报失败。** 未采用，因为这需要在 CLI、cmdline、app-boot 与 SDK 包之间新增约定，而服务器可以从它本来就在等待的 Loader 中读取同样的配置项失败。

**把名称不匹配的 cordis.yml patch 改为错误。** 本次未做。vendored include 会以警告跳过这类 patch，使同一个 overlay 能服务多棵插件树；改变这一点属于单独的 vendor 决策。

## 影响

配置错误的 SDK profile 现在会让 SDK 启动调用失败，并给出失败的配置项与原因。回滚期间传输层关闭后才到达的请求不会得到响应；客户端随后会报告传输层已关闭，并附带 stderr 末尾内容。

## 验证

`rsh/Programs/SDK/packages/server/tests/plugin-apply.spec.ts` 启动一个包含服务器与两个 `fs` 提供方的 Loader group，在启动期间发送 `initialize`，并检查重复服务错误。另外两个用例覆盖嵌套 group 中失败的子项，以及在延迟注入之后失败的 fiber；它们的错误带有伪造密钥，测试检查只有错误类型到达客户端。
