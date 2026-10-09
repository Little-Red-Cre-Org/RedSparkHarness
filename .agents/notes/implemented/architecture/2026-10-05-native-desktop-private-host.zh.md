# Agent Note: 显式原生 Desktop 私有 Host

Status: implemented

[English](2026-10-05-native-desktop-private-host.md) | 中文

## 问题

原生 Client 预览仍将 Desktop Agent 与 Session 留在兼容 Host。原生安装需要选择实际 Host，同时保持现有 Desktop 默认项且不开放服务器。

## 决策

私有 Host 在导入任一组合前读取显式 profile runtime 标记。原生模式复用 CLI profile 校验与安装规划，在同一作用域计划内提供 Electron 既有 Connection 传输，并仅激活一次所选 Session controller 与 Provider。所选 Client 替换根页面。包及导出的真实路径均必须位于已安装 profile 或运行时内。只有 Desktop 以显式允许链接包方式启动的工作区开发项目跳过此包含检查，并从工作区构建其 Client。规划加载器唯一允许的计算导入是已经从经校验安装清单解析出的导出入口。

## 考虑过的替代方案

**在兼容 Host 旁启动原生 Web 服务器：**增加监听器和另一个应用所有者，也可能重复执行 Agent。Electron 已持有私有分帧 Fetch 管道。

**将 CLI 解析器复制到 Desktop：**独立解析器的清单校验与 patch 行为会发生偏差。仅提供规划能力的库导出复用解析器，不新增应用启动器。

**允许已安装 Desktop 使用源码工作区链接：**这使签名运行时执行安装目录之外的代码。共享资源构建器使用显式的仅安装模式。

## 后果

原生模式要求仅启动时配置、所选 Session controller 及其 Provider，以及原生 Client 配置。Cordis patch 与竞争的传输或 application Provider 在激活前被拒绝。Electron 在发布准备期间保留已有显式原生配置，并在停止 Host 前拒绝兼容插件变更。兼容组合及默认项继续可用。Desktop 录制 Session 使用实际私有 Host 进程、已安装包、Client 资源及冷恢复；GUI 渲染与尚未支持的兼容菜单仍需独立验收。此变更不修改 Session 格式或 SDK 转录。
