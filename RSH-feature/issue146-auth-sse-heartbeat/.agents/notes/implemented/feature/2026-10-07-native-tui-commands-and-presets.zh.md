# Agent Note：原生终端命令与常驻 preset

状态：已实现

[English](2026-10-07-native-tui-commands-and-presets.md) | 中文

## 问题

原生终端提供 Session 与模型控制，但没有连接共享命令 Registry 或可选原生 profile 装配。用户无法从终端调用 Goal 命令，也无法在 Session 开始前选择真实 scope 装配。

## 决策

`native-tui` profile 安装共享 `commands` Provider、Goal 命令、`agent-presets` Registry 和两个常驻装配。`standard` 与 `minimal` 使用不同的子 scope；Goal 工具只安装在 `standard`，Todo 工具安装在两者中。profile 模板保持显式，不改变其他 Program 的 preset 默认值。

终端保留本地控制名称。`/help` 会列出当前 scope 可见的扩展命令并过滤本地保留名称；无效命令参数，以及既不匹配命令也不匹配 Skill 的斜杠输入，仍在本地处理。已安装命令分发未匹配后，终端会调用可选 `skillInvocations`，并传入准确选定的根 Session Agent scope、可选 Session cwd 和所选 Program 的精确 `requestContexts` 注册表。已安装的手动 consumer 使用共用 Skill resolver；只有其安装 scope 包含所选 scope，且其精确 request-context 注册在加载前后仍为最近的可见胜者，才会接受查询。只有 Skill 允许用户调用时，原斜杠文本才会排队。取消、人机请求、owner 变更或关闭先发生时，未完成查询不会排队输入。其他命令通过准确选中的根 Session owner 和既有原生执行器分发。因此 `/goal pause` 可以中断活动 Goal 模型请求，不会排在它之后。共享命令 Provider 在 Session 中记录命令执行事实；终端不新增 writer。

## 考虑过的替代方案

**把所有斜杠命令都当作普通模型输入：** 否决，因为 Goal pause 会排在它需要中断的模型轮次之后，命令处理器也会变成模型可见用户输入。只有命令未匹配且解析为允许用户调用的 Native Skill 时，输入才进入用户消息队列。

**让两个 preset 名称注册在同一个 scope：** 否决，因为两种选择会暴露相同的工具与提示词贡献。

**全局替换兼容 profile preset：** 否决，因为原生 TUI 只需要显式选择的装配，其他 Program 保持既有 preset 行为。

## 后果

原生 TUI 用户可在首次轮次前选择 profile 安装的不同 scope，并调用共享命令处理器，同时不创建第二个 Session writer。未匹配命令的斜杠文本可通过选定 Session 的准确 scope 和 cwd 调用允许用户调用的 Native Skill；未知名称仍显示本地不可用命令提示。自定义原生 TUI profile 必须安装 Registry 与其公布的每个常驻装配。扩展不能覆盖本地命令名称。

## 验证

`native-tui` PTY snapshot 通过 `dsh --profile native-tui` 启动，选择已发布的 Minimal scope，检查其真实工具 schema，拒绝本地名称冲突与未知命令，中断正在运行的 Goal 请求，并恢复同一个 Session。Native Skill 路由 PTY 用例保留 `/missing` 提示，只在已安装命令分发未匹配后到达 Archify，并检查原斜杠文本与 Skill 指令进入模型请求，同时绝对安装路径不进入请求或 Session 日志。Controller proof 验证取消、人机请求和关闭都会阻止未完成的 Skill 查询排队输入。原先 pin 的 preset-control Session 仍由独立兼容 Registry fixture 负责。
