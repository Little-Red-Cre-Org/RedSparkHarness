# Agent Note：发布 Workflow types runtime 模块

Status: implemented

[English](2026-10-07-workflow-types-runtime-publication.md) | 中文

## 问题

Workflow 根 bundle 会导入生成的 `lib/types.js` runtime 模块。包 allowlist 包含嵌套的 `lib/types/**/*.js` 输出，却遗漏了这个位于根层级的模块，因此已安装后的根入口无法解析自身的 runtime 依赖。

## 决策

Workflow 包显式发布 `lib/types.js`，workspace package-payload policy 也要求包含同一精确文件。公共 `./types` 导出保持原有目标和行为。

## 考虑过的替代方案

**发布 `lib/` 下的所有 JavaScript 文件：** 拒绝，因为这会让包超出已声明的入口，并加入无关的生成文件。

**修改 `./types` 导出目标：** 拒绝，因为缺失模块由根 bundle 导入；修改另一个公共子路径无法修复该 import，还会改变其既有路径。

## 后果

打包后的包会包含 `lib/index.js` 所需的 runtime 模块，同时保留现有 `./types` 消费路径。精确 payload 预期可避免包 allowlist 再次遗漏这个根层级产物。

## 验证

Host TypeScript build 与 tsdown build 会生成 `lib/types.js`；构建后的根入口会导入它。Package-payload 测试要求包含该文件，打包后的 consumer 检查会导入根入口、native 入口及既有 `./types` 子路径。
