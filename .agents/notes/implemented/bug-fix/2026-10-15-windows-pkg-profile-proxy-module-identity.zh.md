# Agent Note: Windows pkg profile 代理保留单一快照模块实例

Status: implemented

[English](2026-10-15-windows-pkg-profile-proxy-module-identity.md) | 中文

## Problem

pkg 的 Windows loader 可以通过 C: 与 V: 两种盘符别名读取同一个快照文件。ESM 按 URL 标识模块，因此 profile 代理若重新导出 C: URL，就可能在通过 V: 解析的裸导入旁加载第二个提供方实例。

## Decision

`dsh-app-boot` 根据 `process.pkg.entrypoint` 与 `defaultEntrypoint` 推导 Windows 快照根目录。它通过 pkg 的 V: 别名写入该目录内的目标，并让普通文件系统目标继续使用 `pathToFileURL` URL。

## Alternatives considered

**进程级 symbol registry 或放宽 export allowlist。** 这会掩盖重复的模块实例或暴露不受支持的包路径，而不是对齐 ESM 模块 URL。

**重写所有 Windows 路径。** 外部文件不属于 pkg 快照，因此继续保留普通磁盘 URL。

## Consequences

Profile 代理与裸导入通过同一个 V: URL 解析快照文件，而普通 Node 和外部包目标保持原有 URL 行为。打包 loader 若更改映射方式，路径推导也必须随其 VFS 别名更新。

## Testing

[`profile.spec.ts`](../../../../rsh/Compatibility/DSH/boot/app-boot/tests/profile.spec.ts) 中的 Windows 用例执行 `healProfilesModuleFallback`，并分别验证 V: 快照目标与外部磁盘目标。范围受限的 pkg SEA 探针确认 C: 与 V: 会访问同一挂载文件，但形成不同的 ESM 缓存键。
