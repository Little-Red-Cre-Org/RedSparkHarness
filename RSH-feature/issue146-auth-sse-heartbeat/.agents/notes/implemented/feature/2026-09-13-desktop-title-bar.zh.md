# Agent Note: Windows 一体化标题栏

Status: implemented

[English](2026-09-13-desktop-title-bar.md) | 中文

## Problem

独立的系统标题和菜单行与 RedSpark 主题脱节，并占用工作区高度。

## Decision

Windows 使用 Electron 隐藏标题栏与原生控件叠层。隔离预加载脚本负责紧凑的拖动区域和支持无障碍访问的应用菜单按钮，不向 Web 客户端暴露新的 JavaScript 权限。主进程在更新原生控件颜色前验证自有渲染页面来源和十六进制颜色。自包含恢复页面在预加载失败时仍保留拖动区域，其他平台保留系统窗口边框。

## Alternatives considered

**使用 HTML 绘制窗口按钮：** 这需要重建系统行为与无障碍支持。原生叠层控件保留由操作系统负责的窗口操作。

**将 Electron 标题栏加入共享 Web 布局：** 这会耦合浏览器展示与桌面操作。预加载脚本负责标题栏使 Web 保持不变，也覆盖桌面启动和插件页面。

## Consequences

标题栏在应用上方预留 40 像素。定向测试覆盖平台排除、菜单调用、主题同步与 IPC 请求拒绝。原生拖动、贴靠布局与窗口按钮命中需要 Windows 图形界面验收，Electron mock 测试无法证明这些行为。桌面运行时、签名与包管理授权决策保持独立。
