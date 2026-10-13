# Agent Note：原生 Web 人工回答保留根所有者

Status: implemented

[English](2026-10-05-native-web-human-interaction.md) | 中文

## 问题

运行中的原生 Web 调用可能需要工具审批或人工回答。只呈现持久化记录无法完成这些 Provider 请求，而另一份 UI 执行注册表会重复 Agent 与 Session 权威。

## 决策

Web Program 向所选审批与用户问题 Provider 注册回答者。只有它拥有跟随流的精确活动根调用接收展示。根捕获在展示和回答前验证应用所有权，即使另一个 Web 准入正在等待同一 Session。每次调用按先后顺序呈现输入，全局上限由配置指定。回答携带经过认证的 Session、调用与展示标识，并重新检查活动根写入者。取消在执行结算前撤销待答输入；过期答案不能应用到后继所有者。

问题答案 JSON 校验与既有 broker 共用。浏览器只保留临时展示数据、选项与提交状态，不追加 Session 事件。既有工具消费者通过唯一写入者持久化审批决定与问题结果；冷恢复呈现这些事实。

既有 `session/answer-human` 请求也接受 `{ kind: 'cancel-questions' }`，用于精确的待答问题展示。它以既有 `UserQuestionError` 的 `ASK_CANCELLED` 错误码拒绝该 Provider 等待，只移除该展示，保留借用的 turn signal 和其他等待。工具 Consumer 通过唯一写入者记录错误；下一模型 step 接收工具错误，并可继续同一轮。取消前仍执行身份认证、准入、根所有权及过期答案检查，包括重复或迟到请求。

普通根审批展示只为 Provider 准入的范围携带 `canAllowSession`。经过身份认证的 `allowed-session` 回答通过既有服务请求记住该范围，浏览器输入不提供指纹。唯一写入者在决定审计中保存原 Session 身份及精确的工具、参数、解析目标与 cwd 指纹。冷恢复可以复用，复制或 fork 历史不能转移权限。当前审批按钮保持不变，沙箱升级仍只允许一次。

## 考虑过的替代方案

从持久历史恢复待答输入会接受过期请求。轮询状态无法识别精确 Provider 操作。第二份 Agent 或 Session 注册表会与所选执行器竞争。既有认证跟随流与控制请求提供所需展示和回答。

## 后果

显式 native-web 模板安装既有问题 Definition 与工具 Consumer；旧默认值保持不变。失败的答案仍可修改。审批输入接受允许一次或拒绝，仅在范围已准入时接受 Session 记住请求。所有者移除与安装卸载在 Provider 等待清空前释放展示 Promise。不引入独立展示日志或权限。
