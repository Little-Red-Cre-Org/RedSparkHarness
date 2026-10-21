# Agent Note：原生终端命令与常驻 preset

状态：已实现

[English](2026-10-07-native-tui-commands-and-presets.md) | 中文

## 问题

原生终端提供 Session 与模型控制，但没有连接共享命令 Registry 或可选原生 profile 装配。用户无法从终端调用 Goal 命令，也无法在 Session 开始前选择真实 scope 装配。

## 决策

`native-tui` profile 安装共享 `commands` Provider、Goal 命令、`agent-presets` Registry 和两个常驻装配。`standard` 与 `minimal` 使用不同的子 scope；Goal 工具只安装在 `standard`，Todo 工具安装在两者中。profile 模板保持显式，不改变其他 Program 的 preset 默认值。

终端保留本地控制名称。`/help` 会列出当前 scope 可见的扩展命令并过滤本地保留名称；未知斜杠输入与无效参数在本地处理，不会进入模型对话。其他命令通过准确选中的根 Session owner 和既有原生执行器分发。因此 `/goal pause` 可以中断活动 Goal 模型请求，不会排在它之后。共享命令 Provider 在 Session 中记录命令执行事实；终端不新增 writer。

## 考虑过的替代方案

**把斜杠命令放入模型输入队列：** 否决，因为 Goal pause 会排在它需要中断的模型轮次之后，命令文本也会成为模型可见用户输入。

**让两个 preset 名称注册在同一个 scope：** 否决，因为两种选择会暴露相同的工具与提示词贡献。

**全局替换兼容 profile preset：** 否决，因为原生 TUI 只需要显式选择的装配，其他 Program 保持既有 preset 行为。

## 后果

原生 TUI 用户可在首次轮次前选择 profile 安装的不同 scope，并调用共享命令处理器，同时不创建第二个 Session writer。自定义原生 TUI profile 必须安装 Registry 与其公布的每个常驻装配。扩展不能覆盖本地命令名称。

## 验证

`native-tui` PTY snapshot 通过 `dsh --profile native-tui` 启动，选择已发布的 Minimal scope，检查其真实工具 schema，拒绝本地名称冲突与未知命令，中断正在运行的 Goal 请求，并恢复同一个 Session。原先 pin 的 preset-control Session 仍由独立兼容 Registry fixture 负责。
