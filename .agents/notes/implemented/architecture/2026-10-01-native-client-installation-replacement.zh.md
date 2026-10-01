# Agent Note：原生 Client 安装替换

状态：已实现

[English](2026-10-01-native-client-installation-replacement.md) | 中文

## 问题

原生 Client 启动内核只暴露启动和停止。配置变化后重建内核会丢弃未变化的 renderer 与传输所有者；缺少完整计划就替换模块选择，可能让已挂载 React root 使用已释放服务。

## 决策

`NativeClientHost.replace({ modules, selections })` 串行准备完整 Client 图，并把已解析计划交给 `NativeHost.replace()`。启动生命周期保留一个作用域及挂载请求。仅当导出的插件标识与配置相等时，选择 id 才保留原请求；`dequal` 提供可移植结构比较，不导入 Node 工具，也不维护第二套相等判断实现。依赖变化仍由共享运行时重新激活受影响 Consumer。

挂载请求消费选中的应用和 renderer。替换先释放此 Consumer，再释放变化的 Provider，因此 React root 先卸载，应用才撤销 slot，后继实例才接管容器。未变化的 renderer 与 SlotRuntime 实例保持活动。导入或解析拒绝保留当前 UI；清理或激活失败关闭 Host，不恢复已释放服务。`host.signal` 暴露整个组合取消。

`stop()` 立即关闭准备接收，并等待已接收导入与运行时清理结束，包括清理失败。取消后才完成的导入不能激活后继实例。竞争替换根据最后提交的请求表准备。浏览器入口转发同一操作，初始样式归其所有，保留至停止。

## 考虑过的替代方案

**任意变化都重启整个 Client：** 否决，因为会丢弃未变化的 Provider 标识及状态。

**按 JSON 文本比较配置：** 否决，因为属性顺序变化未必改变配置。可移植 Client 使用已安装且有人维护的相等判断依赖。

## 结果

Client 内核可以替换配置及显式传入的模块导出。Native Web Host 的 live 模式现在监视 profile 目录，通过认证的 Connection Fetch 路由发布带版本的 wire，并且只有完整候选 bundle 成功后才更新资源表。浏览器在提交替换前加载候选样式并导入模块；候选失败会保留当前 UI 和样式。启动作用域仍为单一根；源码级模块 HMR、任意旧插件重载和完整 Client 迁移仍不属于本决策。

## 验证

六项真实 React 和 SlotRuntime 用例覆盖无变化时标识保留、应用配置变化、导入与配置拒绝、导入阻塞时停止、竞争计划、模块导出变化及后继激活致命失败。Host HTTP 与配置测试覆盖认证路由所有权和 live 模式校验；既有启动和浏览器入口测试也验证 renderer 获取、注入数据校验与样式清理。打包后的原生消费者在没有 Cordis 时，依据发布声明对替换、取消和停止进行类型检查。
