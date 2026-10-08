# Agent Note: 将无 Cordis 的叶子包纳入严格原生名册

Status: implemented

English | [中文](2026-10-08-cordis-free-leaf-packages.md)

## 问题

[兼容性清单](2026-10-01-cordis-compatibility-inventory.zh.md)将十一个包归类为 `migration-required`，但它们的生产源码没有从 Cordis 导入任何内容。工作区依赖策略仍要求严格原生名册之外的每个包声明匹配的 Cordis peer 与开发依赖，因此这些包声明了从不加载的框架 peer。这些库的原生消费者因此继承了未使用的 Cordis 要求，清单也无法把它们与仍实现 Cordis 插件的包区分开。

## 决策

将 `dsh-chunked-list`、`dsh-deque`、`dsh-package-manifest`、`dsh-util-time` 与 `dsh-client-ui-dockkit` 加入 `native-package-policy.ts` 的 `nativePackageDirectories`，并从它们的 `peerDependencies` 与 `devDependencies` 中移除 `@deepseek-ai/cordis`。这五个包都没有位于已准入原生图之外的工作区依赖，测试也都不导入 Cordis。四个 Core 工具包使用默认的 Host 与 Client 编译面；`dsh-client-ui-dockkit` 使用 Web Client 包默认的 Client 编译面。它们的导出、入口、打包产物与行为均不变；由于它们都不注册服务，因此不添加 `dsh.native` 安装器。

其余六个包保留在名册之外：

- `dsh-typert-generator` 将 Cordis 服务与事件声明投影为目录；其测试导入并扩充 `@deepseek-ai/cordis`，开发依赖也包含原生图之外的旧包。
- `dsh-fs-e2b` 与 `dsh-host-directory-picker-native` 默认导出旧服务的子类（来自 `dsh-fs` 的 `FileSystem`、来自 `dsh-host-directory-picker` 的 `DirectoryPicker`），因此仍通过这些包作为 Cordis 插件存在，其 spec 也构造 Cordis `Context`。
- `dsh-experimental-agent-team-profile` 与 `dsh-experimental-agent-team-web-profile` 发布由 Cordis Include 加载器消费的 `cordis.patch.yml` bundle 层，并依赖实验性 Cordis 插件。
- `dsh-python-runtime-closure` 是 Python 运行时 wheel 的纯依赖部署根；由于该 wheel 发布旧版 `sdk` profile，它在 `dependencies` 中声明 Cordis 与 Loader 包。

## 考虑过的替代方案

**将 Cordis peer 设为可选而非移除：** 清单把可选 Cordis peer 计为 Cordis 要求，而在从不加载 Cordis 的包上保留可选 peer，仍会记录一个并不存在的依赖。

**转换全部十一个包：** 从保留的六个包移除 peer，会让真实的 Cordis 运行时或测试要求失去声明，或把 Cordis 组合误分类为无框架包。

## 后果

原生与兼容消费者无需安装 Cordis 即可导入这五个模块；`verify-package-dependencies`、`check-workspace-constraints` 与 `verify-native-dependencies` 现在会拒绝向它们添加任何 Cordis 声明或导入。清单的 `migration-required` 数量从 159 降至 154，`native-migrated` 数量从 62 升至 67。保留的六个包只有在其旧服务基类或 bundle 格式获得原生替代后才成为迁移候选。

## 验证

兼容性清单将这五个包报告为 `native-migrated`。在这些包进入严格名册后，包依赖、工作区约束与原生依赖检查器均通过，这些包自身的 spec 以及其 Web 与 Engine 消费方的 spec 均无需修改即通过。
