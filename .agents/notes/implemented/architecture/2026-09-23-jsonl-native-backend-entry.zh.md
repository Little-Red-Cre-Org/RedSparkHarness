# Agent Note: 共享 JSONL 后端入口

Status: implemented

[English](2026-09-23-jsonl-native-backend-entry.md) | 中文

## 问题

JSONL 原生 Provider 为取得 `JsonlSessionBackend` 而导入包的 Cordis 插件入口。加载该入口也会加载旧服务适配器，而后端的 tracker 还持有 Cordis 监听器注册，尽管原生存储只需要句柄和文件操作。

## 决策

`backend.ts` 拥有共享 JSONL 存储实现，且不直接导入 Cordis。`native.ts` 直接导入它。`index.ts` 仍是旧插件入口，注册三个旧 Session 事件路由和清理 effect；它把事件处理委托给后端方法，因此两个入口使用同一个写入者 tracker 和磁盘格式。包根入口继续为现有消费方重新导出后端。Session、持久化约定以及提供方无关的 LLM 辅助函数分别公开原生入口；当前格式与历史格式的校验使用这些入口。

Session 格式目录生成器从 `dsh-session/native` 导入当前事件词表。JSONL 分别构建旧入口与原生入口，避免共享 chunk 把旧 Session 服务带入原生入口。

Session 对象接收由存储所有者提供的发布钩子。旧存储在 Session 追加提交前解析带作用域的监听器快照，在日志增长后向这些监听器发布；重入追加受到拒绝，detach 在发布区间内延后。分离状态下的原生 Session 没有该钩子。这保留了既有发布时间，同时从 Session 对象模块中移除了 Cordis。

## 考虑过的替代方案

**复制一个原生存储后端：** 两套实现在已发布 generation 的迁移、持久性和单写入者行为上容易分歧。

**继续让 tracker 注册监听器：** 这会让原生入口的源码依赖链包含 Cordis 类型，并把旧应用装配放进存储记账层。

## 结果

构建后的 JSONL 原生入口沿当前 JavaScript 传递依赖链加载时不会加载 Cordis。这些包仍因旧包根入口声明必需的 Cordis peer，因此 P5 需要先分类原生子入口的 manifest 与声明文件，才能宣称通过严格的独立消费方检查。

## 验证

JSONL 包通过类型检查，两个入口均已打包。Node 模块解析钩子拒绝 `@deepseek-ai/cordis` 时，构建后的原生入口仍成功导入。原生和旧 JSONL 测试通过，覆盖共享存储行为与旧实时事件路由。
