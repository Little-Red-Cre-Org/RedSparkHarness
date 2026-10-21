# RedSpark Harness · SPH 本地验收

双击桌面 **RedSpark Harness 一键验收**：打开验收清单、Web 界面和桌面客户端。也可分别使用桌面的客户端或 Web 快捷方式。Web 有访问令牌，请通过快捷方式打开；直接访问不带令牌的地址可能返回 401。

## 检查项

- 左上角与 Web 页签显示 RedSpark Harness，PWA 简称为 SPH。
- 首页显示火焰星芒、赤绯角色和“让想象，燃起星火”。小尺寸标记为简化版，完整设计图保留在下方链接。
- 赤绯使用独立透明四帧素材：待机会呼吸和眨眼，悬停或点击会挥手；点击可切换问候语。暂停按钮会停止动画；默认遵循系统减少动态效果，也可点击“启用动效”主动开启。这是应用内桌宠，不是系统悬浮桌宠或 Live2D。
- 设置中的浅色 / 深色模式采用绯红、暖白与炭黑配色；输入、代码和错误信息仍清晰。
- 首次模型配置支持服务商选择与自定义接口；DeepSeek 等真实服务商名称保留，尚无 RedSpark 模型服务。
- 缩小窗口时布局不横向溢出；窄屏或短窗口隐藏首页角色装饰。
- 客户端启动页显示 RedSpark Harness。重新启动客户端加载最新桌面产物。
- README 说明基于 DeepSeek Harness 开发，保留上游文档、社区、引用与许可证。

## 文件

- [中文 README](README.zh.md) / [English README](README.md)
- [RedSpark 原始品牌图](apps/web/public/brand/redspark-reference.png)
- [赤绯原始设定图](apps/web/public/brand/kitsune-reference.png)
- [SVG 应用标记](apps/web/public/favicon.svg)
- [一键启动脚本](scripts/launch-redspark.ps1)

## 验证范围

这是源码开发运行版，不是签名安装包。模型 API 调用需要你自己的服务商凭据，本次视觉验收不自动发送模型请求。内部命令和包名仍保留 `dsh` / `DSH_*`，避免破坏上游兼容性。
