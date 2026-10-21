# 读取已授权的 Chrome 页面

[English](browser-read-only.md) | 中文

## 概要

本指南把 Windows Chrome 连接到已构建的 Native Harness。你在扩展中逐页授权，再在会话中批准读取。本地连接无需付费服务；发送任务仍会使用已配置的模型。可将本 Markdown 文件保存在本地，离线查看安装步骤。

对于显式配置的 Native Desktop profile，将浏览器模块安装到该 Host profile，再从空闲会话点击**在 IDE 中打开**。嵌入会话共享该 Host 的浏览器授权、审批及持久化结果。将模块加入独立的 `native-ide` 编辑器 profile 不会增加会话工具，也不会自动转换或更新现有标准 Desktop profile。

## 目录

- [配置 Native profile](#prepare-the-native-profile)
- [安装 Chrome 连接组件](#install-the-chrome-connection)
- [读取与撤销](#read-and-revoke)
- [排查问题](#troubleshooting)
- [开发说明](#dev-note)

<a id="prepare-the-native-profile"></a>
## 配置 Native profile

准备已构建的源码工作区，并确保 Node.js 和 pnpm 可用。先运行一次 `pnpm dsh --profile native-web` 创建 profile，再停止该实例。试用时使用独立 `DSH_HOME`；其 `profiles/native-web` 目录须包含 `rsh.profile.json` 和 Native profile 清单。不要把安装条目写入 `cordis.yml` 或独立的 `native-ide` 编辑器 profile。

若可选包尚无 `lib/native.js`，在源码根目录构建：

```powershell
pnpm exec tsc -b rsh/Modules/Official/web/browser-read-only
pnpm --dir rsh/Modules/Official/web/browser-read-only exec tsdown
```

在 Native profile 目录运行 `pnpm add "link:E:/your-checkout/rsh/Modules/Official/web/browser-read-only"`，把路径替换为实际源码位置。在 `rsh.profile.json` 的 `installations` 数组加入以下条目，并将用户路径替换为自己的私有本地应用数据目录。保留现有工具、审批服务与会话应答方。

```json
{
  "id": "browser-read-only",
  "plugin": "@deepseek-ai/dsh-browser-read-only",
  "scope": "root",
  "config": {
    "connectionFile": "C:/Users/you/AppData/Local/RedSparkHarness/browser-read-only/connection.json"
  }
}
```

重新启动同一 Native profile。连接文件含本地认证密钥，不要放进代码仓库、共享目录、提示词或截图。并发 Host 须各用不同文件；Chrome 注册项选择其中一个 Host。其他参数见[包参考](../../../Modules/Official/web/browser-read-only/README.zh.md)。

<a id="install-the-chrome-connection"></a>
## 安装 Chrome 连接组件

在同一源码工作区运行注册命令，为当前用户安装 Native Messaging 转发配置，连接文件路径必须与上一步一致：

```powershell
$connectionFile = Join-Path $env:LOCALAPPDATA 'RedSparkHarness/browser-read-only/connection.json'
& ./rsh/Modules/Official/web/browser-read-only/scripts/register-chrome.ps1 -ConnectionFile $connectionFile
```

打开 `chrome://extensions`，启用“开发者模式”，选择“加载已解压的扩展程序”，选中脚本打印的包内 `extension` 目录。扩展名为 **RedSpark Harness Read Only**，可将其固定到工具栏。注册不会自动安装扩展，也不会改变默认 Harness profile。

<a id="read-and-revoke"></a>
## 读取与撤销

1. 打开普通 HTTP 或 HTTPS 网页，点击扩展图标或按 **Alt+Shift+R**。
2. 点击“连接”，再点“授权当前页”，核对列表中的标题和网址。Harness 只列出授权页面，不列出其他标签页。
3. 在正在运行的 Native 会话中提出：“读取已授权的浏览器页面，并引用来源网址。”出现 Harness 审批时批准此次读取。工具结果包含标题、网址、正文和截断标记，并保存到该 Session。
4. 点击页面旁的“撤销”停止后续读取，或点“断开连接”清除全部授权。导航、刷新、关闭标签页及断开也会使授权失效。需要时重新连接并授权。

授权适用于所连接的 Host；每个读取会话仍使用现有审批流程。撤销不会删除已经记录或发送给模型的内容。扩展排除表单值和 Cookie，但可见正文仍可能含个人信息。仅提取顶层文档文本，不能操作网页，也不能读取 PDF、图片、iframe 或影子根内容。具体见[范围与限制](../../../Modules/Official/web/browser-read-only/README.zh.md#known-limitations-and-deferred-work)。

<a id="troubleshooting"></a>
## 排查问题

| 现象 | 处理 |
|---|---|
| 无法连接 | 检查 Native profile 正在运行、注册使用同一个连接文件、Node.js 与已构建转发程序的位置未改变，再手动连接。 |
| 不能授权页面 | 打开普通 HTTP(S) 页面，从该标签页打开扩展。Chrome 内部页面、扩展页和本地文件网址不受支持。 |
| 缺少审批服务或读取被拒绝 | 使用包含现有审批服务和应答方的 Native 会话 profile，并批准具体读取；浏览器授权不会绕过 Harness 审批。 |
| 页面变化或读取超时 | 检查原标签页，重新打开扩展并授权；不会自动重试。 |
| 连接文件已存在，阻止启动 | 确认所属 Host 已停止后，再删除残留发现文件。不要删除运行中 Host 的文件。 |

永久停用时，在已停止的 profile 中移除浏览器安装条目和本地包链接，移除 Chrome 扩展，再为注册命令添加 `-Unregister` 执行。脚本只注销属于该安装的当前用户 Chrome 主机，保留文件、浏览器数据和全部 Session。

<a id="dev-note"></a>
## 开发说明

连接脚本注册的是私有 stdio 转发程序；应用仍通过 `dsh --profile` 启动。本地验收不使用模型 API 凭据。模型提供商的质量、费用和行为需用选定账号另行验证。
