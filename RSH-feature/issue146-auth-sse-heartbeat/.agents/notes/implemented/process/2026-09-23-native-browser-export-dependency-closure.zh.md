# Agent Note: 原生浏览器入口无需 Cordis 即可安装

Status: implemented

[English](2026-09-23-native-browser-export-dependency-closure.md) | 中文

## Problem

[已发布依赖策略](2026-08-26-published-dependency-faces.zh.md)要求 Client 包在包级声明 Cordis peer。因此，即使消费者只导入从不加载 Cordis 的新原生浏览器子路径，也会安装 Cordis。普通静态 Client 构建还会把工作区导入留在产物外部，却将这些包归为开发依赖；仅给旧包添加 `./native`，可能使发布的 JavaScript 或声明引用隔离安装中不存在的包。

## Decision

混合 Client 包只有发布独立 `./native` 出口时，才能将 Cordis peer 标为可选。`verify-package-dependencies` 检查精确的 `{ "optional": true }` 元数据，并继续要求 Cordis peer 与开发依赖使用一致范围；没有原生出口的包不能选择这种处理。现有根入口与 `./client` 入口仍使用 Cordis，调用方未安装 Cordis 时导入它们会失败。

`verify-optional-dependency-imports` 沿原生源码入口及其静态值导入检查，在可达源码中拒绝 Cordis，同时允许独立旧入口加载 Cordis。测试夹具证明原生入口间接导入 Cordis 会被拒绝。下述安装消费者测试另行验证构建产物路径。

`dsh-client-modules/native` bundle 包含浏览器模块表与图解析器；公开类型引用 `dsh-package-manifest` 的包声明解析器留在旧入口。`dsh-client-web/native` bundle 包含原生安装运行时，对外暴露结构化的浏览器输入与 host 生命周期类型。两个原生入口的打包 JavaScript 和公开声明闭包均不导入其他工作区包。构建产物测试会打包两个包，在空项目中离线安装、拒绝 Cordis 导入、检查 Cordis 缺席，并在不跳过库检查的情况下编译 NodeNext 消费者。

## Alternatives considered

**把 Cordis 标为可选，但不检查安装产物。** 工作区测试总能找到 Cordis 和所有开发包，无法证明可选 peer 缺席时仍安全。这里必须用隔离打包消费者提供证据。

**发布仍导入原生运行时、却只把它列为开发依赖的 Web 入口。** 一旦独立安装缺少该工作区运行时包，`./native` 入口会失败。因此原生 Web bundle 内含运行时。

**立即拆成原生包和兼容包。** 完整 Client 名册迁移后，独立包可能更合适。当前保留不同导出路径，使 Host 选择与原生渲染器开发期间仍能复用现有图传输。

## Consequences

两个原生浏览器入口现在无需 Cordis 即可安装、导入和完成类型检查。这不代表生产 Web 应用已经原生化：当前应用入口仍激活 Cordis Loader，Host 下发原生选择列表和原生渲染器也尚未完成。未来任何原生入口若在运行时请求其他包，都需要声明自身的安装闭包，并提供隔离消费者证据；单有 `./native` 出口不能证明这些条件。
