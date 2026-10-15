# Agent Note: Windows pkg profile 代理保留单一快照模块实例

Status: implemented

[English](2026-10-15-windows-pkg-profile-proxy-module-identity.md) | 中文

## Problem

pkg 的 Windows loader 可以通过 C: 与 V: 两种盘符别名读取同一个快照文件。ESM 按 URL 标识模块。SEA bootstrap 以 `file:///C:/snapshot/...` 导入入口，VFS resolve 钩子对 C: 父模块的导入保留 C: 盘符，因此可执行文件自身的 `@deepseek-ai/cordis` 实例位于 C: 下。profile 代理若重新导出 V: URL，就会加载第二个实例，通过代理导入 Cordis 的外部插件也会在 `instanceof Context` 检查中失败。

## Decision

`dsh-app-boot` 根据 `process.pkg.entrypoint` 与 `defaultEntrypoint` 推导 Windows 快照根目录。它把该目录内的目标写在入口自身的盘符根目录下，并让普通文件系统目标继续使用 `pathToFileURL` URL。

## Alternatives considered

**进程级 symbol registry 或放宽 export allowlist。** 这会掩盖重复的模块实例或暴露不受支持的包路径，而不是对齐 ESM 模块 URL。

**重写所有 Windows 路径。** 外部文件不属于 pkg 快照，因此继续保留普通磁盘 URL。

## Consequences

Profile 代理与可执行文件自身的导入通过同一个 C: URL 解析快照文件，而普通 Node 和外部包目标保持原有 URL 行为。打包 loader 若更改映射方式，路径推导也必须随其入口 URL 更新。

## Testing

[`profile.spec.ts`](../../../../rsh/Compatibility/DSH/boot/app-boot/tests/profile.spec.ts) 中的 Windows 用例执行 `healProfilesModuleFallback`，并分别验证入口根目录下的快照目标与外部磁盘目标。Windows 上的 installed-wheel `sdk-profile-plugin` smoke 会加载一个外部插件，其 `@deepseek-ai/cordis` peer 必须是可执行文件自身的实例。
