# RedSpark Harness · SPH

[English](README.md) | 中文

RedSpark Harness（SPH）是 RedSpark 的 Agent 平台，基于 [DeepSeek AI](https://deepseek.com) 的开源项目 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 进行开发。RedSpark 是我们的组织名，也是未来自有模型的名称；目前尚未发布 RedSpark 模型。模型服务商保持其实际名称。

桌面端与 Web 端共用绯红、暖白、炭黑主题、火焰星芒标记，以及欢迎页动态伙伴赤绯（Kitsune）。点击角色可挥手，旁边的按钮可暂停动效；默认遵循系统的减少动态效果偏好；“启用动效”可为当前欢迎页明确开启动画。这是应用内精灵动画伙伴，不是 Live2D 模型或系统级悬浮窗口。用户提供的 RedSpark 设计图用于本项目品牌，上游版权与许可证声明继续保留。内部 `dsh` 命令、`DSH_*` 环境变量和包标识保持上游兼容。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

上游参考文档（保留供开发使用）：[DeepSeek Harness 文档](https://deepseek-harness.github.io/deepseek-harness/)。本项目交付见[本地验收说明](ACCEPTANCE.md)。

## 开发者预览

RedSpark CI 在标准 Linux/Windows runner 上检查构建、类型和客户端测试，并在 Linux 上检查 lint 与文档。本仓库的上游发布、部署和服务商自动化在完成集成配置前保持停用，工作流定义与来源声明继续保留。普通 Dependabot 版本更新 PR 已暂停，安全告警保留。这组基础检查不等同于完整的上游覆盖率、浏览器或真实 API 验证。

RedSpark Harness 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 通过 `npm` 运行上游版本

此处保留的命令安装上游 DeepSeek Harness，并非 RedSpark 分支。安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/Little-Red-Cre/RedSparkHarness.git
cd RedSparkHarness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

构建后运行 `pnpm run start:desktop` 可启动 Electron 客户端。开发版数据独立存放在 `apps/desktop/.desktop-build/development/home`。API Key 在应用内配置，不写入仓库。

## 上游社区与支持

以下链接属于上游项目，保留用于开发参考。RedSpark 的变更维护在[我们的仓库](https://github.com/Little-Red-Cre/RedSparkHarness)。

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
