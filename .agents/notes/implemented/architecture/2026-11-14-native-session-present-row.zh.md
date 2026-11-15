# Agent Note: Native Session declared-file row

Status: implemented

[English](2026-11-14-native-session-present-row.md) | 中文

## Problem

Cordis 的 `present` 轮次尾部从 `deliverables/presented` 渲染 `[data-presented-files-row]`。Native 转录没有这一行：它只渲染消息和 Tool 卡片。`web-ptc` 回放断言两个声明文件及其打开、显示操作，因此该组合无法离开 Cordis 清单。

另外，Native 浏览器打包器会经仓库的 tsconfig paths 编译工作区 `.tsx`，而 esbuild 默认使用经典 JSX 转换。没有导入 React 绑定的源码平面组件渲染时会以 `ReferenceError: React is not defined` 崩溃；从已构建 `lib/` 解析的包掩盖了该问题，因为 tsdown 会生成 `react/jsx-runtime` 引用。

## Decision

`ui-deliverables` 把每个 Session 的成功修改调用与 `deliverables/presented` 记录折叠为每个轮次一条记录（`foldDeliverables`）。折叠逻辑位于 `src/fold-deliverables.ts`，在 Cordis `/client` 入口之外，因此 Native 依赖图可以接纳 Session 折叠，而无需接纳 chat、conversation 或 Tool 插槽契约。Native 转录导入 `./native`，每个转录创建一个 `PresentedOpenController`，并在轮次末尾渲染共享交付卡片。

`native-web-session-controller` 注册 `/api/present.host` 与 `/api/present.open`。坐标只来自当前查看的 Session、事件序号和原始文件索引。open 路由读取冷 Session 句柄，不启动 Agent；它重新读取指定事件，要求声明路径在 Session `cwd`（header 缺少时使用配置根目录）内解析为普通文件，再映射到 Host 进程路径，最后才调用 Native 打开或显示命令。坐标格式错误返回 400，无桌面返回 409，声明或文件不存在返回 404，越出根目录或没有 Host 路径返回 422，打开器接受后返回 204。

Native client bundle 设置 `jsx: 'automatic'` 与 `jsxImportSource: 'react'`，与源码平面工作区包使用的 `tsconfig.base.client.json` 一致。

## Alternatives considered

**在 `native-web` 挂载 Cordis deliverables 插件。** 这正是要退役的实现，并且依赖 Cordis chat slots；Native 转录没有对应的行插槽。

**打开浏览器传来的文件路径。** 这会让浏览器成为 Host 文件系统操作的权威。重新读取持久声明可让 Session 日志保持权威，并阻止打开未记录的路径。

**启动 Agent 读取声明。** 打开文件不能唤醒冷 Session，也不能创建模型请求；读取句柄已经提供相同的 header 与事件。

**保留经典 JSX，并要求每个源码平面组件导入 React。** 这会让 bundle 依赖每个文件的导入纪律，而且只能修到第一个恰好被渲染的组件。

## Consequences

声明了文件的 Native 轮次现在会显示与 Cordis 行相同的名称、说明和打开／显示操作，且这些操作使用持久坐标，不需要活动 Agent。该行刻意比 Cordis 卡片窄：它没有侧栏预览，因为 Native 转录没有文件预览标签页。打开仍是 Host 侧操作，并且仍要求服务端有桌面。

打包器现在会用自动运行时编译所有源码平面 TSX 输入。若有工作区 Client 包刻意使用经典运行时，需要逐文件显式修改；但仓库的 Client face 已经要求 `react-jsx`。
