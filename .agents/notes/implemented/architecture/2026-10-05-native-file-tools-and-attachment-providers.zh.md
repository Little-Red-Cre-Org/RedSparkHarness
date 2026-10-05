# Agent Note: 原生文件工具与附件 Provider

Status: implemented

[English](2026-10-05-native-file-tools-and-attachment-providers.md) | 中文

## Problem

NativeTools 的结果持久化不提供文件系统操作或持久图像存储。图像工具还需要已选真实模型 Provider 的元数据；不查询该 Provider 就宣告图像支持，会接纳不支持的路由。

## Decision

[原生文件工具](../../../../rsh/Modules/Official/fs/tool-fs/src/native.ts) 消费已选 Fs 与观测策略，并在 NativeTools 中注册值工具。[附件 Definition](../../../../rsh/Modules/Official/attachment/attachment/src/native.ts) 发布[本地 Provider](../../../../rsh/Modules/Official/attachment/attachment-local/src/native.ts) 使用的相同操作。共享纯执行器保留文本与图像输出。Headless 唯一写入者在观察者接纳和下一模型请求之前，持久化工具结果与追加输入。

两个真实 HTTP Adapter 通过共享 Adapter 类发布原生模型服务与准确元数据查询。原生安装捕获经过验证的静态配置；Cordis 入口保留动态设置及现有授权与扩展注册。原生入口不提供第二模型目录或扩展注册表。图像读取查询 Session 的准确 Provider 与模型，并在缺少图像元数据时拒绝执行。

提示贡献保留其注册作用域。渲染选择消费代理可见的贡献，包括祖先遮蔽与兄弟隔离。Headless 消费者渲染实际代理作用域，并记录组装后的系统消息。

## Alternatives considered

复用仅内容兼容工具会遗漏 NativeTools 值与展示元数据。伪造模型元数据服务会绕过已选 Adapter 的能力。全局提示注册会泄露兄弟贡献。每种替代方案都遗漏真实消费者要求的一项所有权关系。

## Consequences

附件引用与 Session 事件字段不变。附件移除排空已接纳的图像准备、替换变换与缓存写入，然后报告流清理失败。模型移除取消接纳、关闭暂停的迭代器并排空实际 Adapter 操作；next 调用失败会在关闭底层迭代器后保留其请求错误，迭代器清理失败仍由 Provider close 报告。安装配置在替换前保持固定。

## Verification

隔离树已编译附件 Provider、两个真实模型 Provider 与作用域提示 Provider。完整文件工具编译及无密钥产品场景依赖独立进程沙箱批次的发布。这些待完成检查不构成产品验收证据。

选定的异步生成器取消用例在产出 chunk 后保持清理挂起，验证请求与 Provider close 均未提前完成，并保留调用者取消错误的身份，通过 close 报告清理失败。## 验证

隔离源码树已编译完整文件工具、附件 Provider、两个真实模型 Provider 与作用域 Prompt 注册。无密钥的 `read-image-native` 场景通过公开 `dsh` 启动真实 Pi HTTP 适配器，核对持久图片字节与下一次模型请求一致，并冷读唯一 JSONL 日志且不改变字节。记录输出与只读重放均通过；Direct 原生发布已编译，但此场景不调用其 HTTP 端点。

原生与兼容启动器通过仅 Host 的 `./layers` 出口共用现有环境验证加载器。Host 加载在解析两个文件前捕获继承值，在应用值及导入插件前完成验证。每个根作用域获得选定快照 Provider；仅 Client 加载不安装它。

异步生成器取消用例在已产出块后阻塞清理，验证请求和 Provider 关闭均等待清理，保留调用方取消错误身份，并由关闭报告清理失败。
