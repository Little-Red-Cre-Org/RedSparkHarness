# Agent Note：原生 Web 编辑已注册 Settings 与 Credentials

Status: implemented

[English](2026-10-06-native-web-settings-credentials.md) | 中文

## 问题

原生 Web Host profile 已安装 Settings 与 Credentials Provider，但 Session Consumer 没有浏览器操作来编辑用户配置或凭据。

## 决策

原生 Web Session controller 在现有经过身份验证的 `/api` Connection 载体上增加 Settings 与 Credentials 操作，不创建新的 Engine、Connection registry、监听器或授权服务。Desktop 复用现有私有原生 Host 载体及所选 profile 的 Provider。

Settings owner 通过传入 schema 元数据及可选生效时机，选择公开自己的配置界面。Host 只描述显式公开的活动注册项，剥离 schema 声明的机密值、省略所有 schema 默认元数据，并拒绝藏在不支持 schema 节点后的机密字段；之后针对预期 revision 应用可见路径修改。不含机密字段的对象项可在变化路径新增、删除或替换；隐藏机密字段下方的修改按叶子路径写入，不安全的机密结构修改会被拒绝。数组修改使用现有索引，不能创建空洞或删除元素。过期写入返回预期及当前 revision；Client 刷新权威投影，同时保留用户草稿。

凭据引用从标记为 `credential-ref` 的已注册 schema 中发现，不依赖静态 Provider 或密钥目录。Host 仅投影 configured、source 与 writable 事实。Settings 或 Credentials Provider 异常文本会替换为通用 RPC 错误；revision 冲突只保留 namespace 与预期／当前 revision。Client 将值单次发送至 set，成功后清空本地输入，只收到确认；unset 也不返回值。

原生 Client 增加由 locale 管理文案的 Settings 导航、用户覆盖 JSON 编辑器，以及为已发现引用提供的只写控件。编辑器会对不支持的数组扩缩、可见行移动及不安全的机密对象替换报错，不会误报保存成功。成功写入后会从 Host 刷新规范用户层。不切换默认 profile 装配。Session 错误构造器作为共享 Client peer 保留，使 `instanceof` 能匹配选定 Session Consumer 抛出的错误。

## 支持范围

该界面支持由活动 Settings 注册显式发布的 schema，以及其当前解析值中的凭据引用。机密字段必须位于 Settings 脱敏器可遍历的 `object`、`dict` 或 `array` 路径上；不支持的机密 schema 节点仍不能安全公开。UI 不编辑隐藏的 `role('secret')` 字段，不创建授权 grant，不完成不透明 grant 记录编辑，也不复刻旧版插件设置页。浏览器授权登录属于独立工作。

## 考虑过的替代方案

**增加第二个设置监听器或独立 Web 服务。** Host 已拥有一个经过身份验证的 Connection registry、Fetch 载体及请求生命周期；新增端点会重复这些所有者。

**在页面中硬编码 Provider 名称与凭据键。** 注册项已拥有 schema 和当前凭据引用，静态列表会与已安装 Consumer 及 profile 漂移。

**describe 返回凭据或写入后回显。** 现有 Credentials 引用视图有意不包含值字段；浏览器只需获知存在性、来源、可写性和写入确认。

## 后果

Settings 注册必须通过元数据选择公开；基于 schema 的编辑使用路径操作保留未观测字段。冲突后调用方必须刷新并保留草稿。凭据值在 Web RPC 与界面中保持只写；grant 授权与不透明记录仍不受支持。

## 测试

Settings 包回归覆盖公开选择、机密值与默认值脱敏、凭据引用发现、对象与数组路径修改、隐藏值保留及 revision 冲突。经过身份验证的原生 HTTP 用例检查原始 descriptor 脱敏、带机密值的 Provider 失败、过期写入投影及只写 Credentials RPC。Client 测试通过真实 Settings owner 覆盖非机密对象修改、数组索引修改与不安全结构拒绝；定向包编译与浏览器检查覆盖变更源码。
