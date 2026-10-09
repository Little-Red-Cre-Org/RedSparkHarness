# Agent Note：Desktop 原生 Client 预览路由

状态：已实现

[English](2026-09-24-desktop-native-client-preview.md) | 中文

## 问题

原生浏览器启动入口可以在不依赖 Cordis 的情况下组合 Client 插件，但 Desktop 尚无经过校验的包选择、共享浏览器模块图或 Host 自有资源路由。现有默认页面仍由旧版 Web 入口提供。

## 决策

私有 Desktop Host 从项目根目录读取可选的 `rsh.client.json`。修订版 1 列出唯一安装标识、已安装包名和可选 JSON 配置。包查找仅限 Desktop 项目与内置运行时。Host 在导入前校验包身份和已发布的 `dsh.native` 导出，要求目标包含 `client`，并拒绝包含 Cordis 的编译依赖图。

原生 Host 将选中入口合并为一个浏览器 ESM bundle，使共享导入保留唯一模块实例。它会将 bundle URL、样式表、模块标识与选择项注入 `native.html`，并只从内存资源表提供生成文件，作为根应用提供此页面。兼容 Host 只提供现有应用，并会在启动前拒绝 `rsh.client.json`，因为其 Typert Session endpoint 不实现 Native Session 的响应、follow 和 image 路由。它对 `/native.html` 和 `/.dsh/native-client/` 资源返回 404；原生 profile 配置无效会导致 Native Host 启动失败，不会回退。

`rsh.client.json` 选择 Client 入口，但不选择 Host。profile 的 `package.json` 设置 `dsh.profile.runtime: "native"` 和 `dsh.profile.config: "rsh.profile.json"`；组合配置保存在 `rsh.profile.json` 中。Desktop 默认 profile 仍使用兼容 Host；只有真实原生 renderer 覆盖受支持界面并通过 P5 profile 验收后，才能迁移默认页面。

## 考虑过的替代方案

**由兼容 Host 提供 Native Client：** 兼容 Session endpoint 虽有部分名称相同，但响应不同且没有 Native follow 或 image 路由，因此无法提供页面必需的 Host API。

**预览继续使用 Cordis Loader：** 浏览器路径仍依赖 Cordis，无法验证原生 Client runtime。

**每个插件入口单独提供模块 URL：** 各入口可能重复实例化共享依赖，破坏 Client 模块身份。

**现在替换默认页面：** 当前没有覆盖受支持应用界面的生产原生 Client renderer，提前切换会移除既有功能。

## 结果

在现有应用继续作为默认页面的同时，可以通过 Desktop 自有的包解析、打包、启动数据注入与资源服务验证原生 Client 启动流程。已配置但无效的预览 profile 会阻止 Host 启动，让错误在浏览器加载前显式暴露。

此 profile 格式有意区别于 `rsh.profile.json`：它只选择浏览器入口，不包含作用域、Host 或应用语义。不能将其视作未来默认原生组合的替代品。

## 验证

定向测试覆盖 profile 校验、从两个允许的根目录解析包、限制包及入口路径、拒绝 Cordis、合并生成 JavaScript 与 CSS、注入 Host 页面、路由资源，以及浏览器启动和 pagehide 清理。
