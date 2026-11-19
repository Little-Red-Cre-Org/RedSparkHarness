# Agent Note: E2B 包移除 Cordis 入口

Status: implemented

[English](2026-11-19-e2b-packages-drop-cordis-entries.md) | 中文

## 问题

`@redspark/rsh-e2b`、`@redspark/rsh-fs-e2b` 与 `@redspark/rsh-subprocess-e2b` 各自在同一个包中发布两个安装器：`src/index.ts` 中的 Cordis Service 与 `src/native.ts` 中的 Native 安装器，并共享沙箱所有者、文件系统后端与子进程后端。Cordis 那一半继承 `Service`、`FileSystem` 与 `SubprocessRuntime`，把 `@redspark/cordis` 声明为可选 peer，并使该家族留在 `mixedNativeEntryDirectories` 中。没有任何已发布或已文档化的 `cordis.yml` 挂载该家族，因此 Cordis 入口保留了一个没有消费方的启动面，并让 Native profile 已经在使用的包继续依赖 Cordis。

这些入口还固化了 Cordis 特有的拆除方式：所有者与子进程后端通过 `ctx.effect` 注册 disposer，清理失败只会被记录，而不会报告给调用方。

## 决策

这三个包成为不依赖 Cordis 的 Native 包。

`src/index.ts` 重新导出共享实现，且不导入 Cordis 的任何内容：`e2b` 导出所有者与控制 shell 辅助函数，`fs-e2b` 导出 `E2BFileSystemBackend`，`subprocess-e2b` 导出 `E2BSubprocessBackend` 与 `resolveE2BSubprocessPollMs`。`./native` 安装器保持不变：`e2b` 提供 `e2b`，`fs-e2b` 要求 `e2b` 并提供 `fs`，`subprocess-e2b` 要求 `e2b` 并只提供 `subprocess`。

每个清单删除 `@redspark/cordis` 的 peer 与开发依赖、其可选 peer 标记，以及 `@redspark/schemastery`；`e2b` 还删除了不再使用的 Cordis 测试夹具。`dsh.runtime` 能力角色元数据保留，因为它描述的是提供方 seam 而不是运行时。这些包从 `mixedNativeEntryDirectories` 移入 `nativePackageDirectories`，并声明显式的 `host` 编译面。

配置由 Native 校验器负责：`resolveNativeE2BConfig` 接受可选的 `apiKey`、`cwd` 与 `timeoutMs`，`resolveNativeE2BSubprocessConfig` 接受可选的 `pollMs`。生成的配置目录不再列出这些包，子进程子系统页面中生成的 `ctx.e2b` Cordis 服务小节也已移除。

测试直接构造共享对象：`E2BSandboxOwner`、`E2BFileSystemBackend` 与 `E2BSubprocessBackend`。需要密钥的 Loader 组合夹具及其 `bin.ts`、`cordis.yml` 与 LSP 桩随 Cordis 入口一起删除。

## 后果

拆除失败会到达调用方。`E2BSandboxOwner.dispose()` 会重新抛出非 `SandboxNotFoundError` 的 kill 失败，`E2BSubprocessBackend.dispose()` 会抛出单个清理失败，或多个失败时抛出 `AggregateError`。在 Native 下，宿主的资源所有者会把这些失败汇入组合清理失败，因此 E2B 拆除失败会把清理标记为失败，而不是只记录后丢弃。

该家族不再有通过 Loader 组合的、需要密钥的端到端测试。远程凭据清除、进程发布与终端拆除仍由针对假沙箱的测试覆盖，三个 `native.spec.ts` 覆盖配置校验与安装器所有权。现在没有测试通过已发布 profile 操作真实 E2B 沙箱。

Cordis 服务键 `ctx.e2b` 以及名为 `E2BRuntime`、`E2BFileSystem`、`E2BSubprocessRuntime` 的 Cordis 适配器不再存在。共享代码的消费方导入包根入口或 `@redspark/rsh-e2b/owner`；它们无法再通过 Cordis 组合获得 E2B 提供方。

## 考虑过的替代方案

**把 Cordis 入口保留为薄封装。** 它们只转发给共享所有者与后端，但会保留 Cordis peer、混合包分类与第二套测试设施，直到 Cordis 运行时本身被删除；届时仍须移除这些封装，而始终没有消费方挂载它们。

**移植 Service 外壳而不是删除它们。** Native 的 `e2b` 服务外壳会重复已经提供所有者的安装器，Native 的 `fs` 或 `subprocess` 外壳会重复安装器已经提供的后端。这些外壳只增加一层没有独立行为的类。

**把组合夹具改为 Native 启动。** 该夹具的对象是 Cordis Loader 组合及其通过 Cordis 管理 shell 的凭据清除。Native profile 启动已有自己的组合测试，而被删除的夹具并未覆盖 Native profile 加载该家族的情形。
