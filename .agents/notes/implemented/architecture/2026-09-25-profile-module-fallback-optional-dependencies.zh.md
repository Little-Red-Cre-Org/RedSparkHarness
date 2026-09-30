# Agent Note：Profile 后备目录包含已安装的可选包

状态：已实现

[English](2026-09-25-profile-module-fallback-optional-dependencies.md) | 中文

## 问题

dsh 安装将 Cordis 兼容包保留为可选依赖，使原生 profile 可以在不安装它们时启动。隔离的 profile 目录仍需要在所选兼容组合引用这些包时，将已安装的可选包加入模块后备目录。

## 决策

Profile 后备目录发现会遍历每个包的已安装 `dependencies`、`optionalDependencies` 和 `peerDependencies`。只有安装中实际存在的可选包才会建立链接；仅由所选组合包持有的依赖仍保留在对应 profile 中。

## 考虑过的替代方案

**继续只遍历 `dependencies` 和 `peerDependencies`**——不采用，因为 Cordis 兼容包以可选依赖安装，隔离的 profile 因此无法通过包名解析这些包。

## 结果

原生 profile 不会仅因安装清单列出了可选兼容包就加载它们。启用了 Cordis 的 profile 可以从 `$DSH_HOME/profiles/<name>` 解析已安装的兼容配置项。

## 验证

app-boot profile 测试会验证安装级可选依赖及其传递可选依赖的链接。内置 Web scaffold 会通过 profile 后备目录验证包名解析。
