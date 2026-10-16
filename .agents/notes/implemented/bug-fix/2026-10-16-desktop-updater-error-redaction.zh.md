# Agent Note: Desktop 更新错误脱敏

Status: implemented

[English](2026-10-16-desktop-updater-error-redaction.md) | 中文

## 问题

更新器错误可能包含带凭据的代理 URL。Desktop 会向壳窗口发送更新状态，因此转发错误 message 可能泄露这些凭据。日志写入失败时，启动和后端错误也可能错误地声称日志路径可用。

## 决定

`DesktopUpdateState` 的错误状态只携带 `desktopErrorState` 固定集合中的错误类型、可选的发布版本，以及仅在对应日志写入成功时附带的路径；它不携带错误 message。`DesktopUpdateCoordinator` 会在发布状态前记录原始更新器错误。`afterFailedRestart` 失败时，写入日志的聚合错误同时包含更新器错误和恢复错误。

`logDesktopError` 返回是否成功写入 `app.getPath('logs')/desktop.log`。后端和启动状态、普通与应急错误页、更新弹窗仅在写入成功后附带日志路径；否则界面使用通用的本地日志提示。更新弹窗会本地化固定错误类型。[Desktop 启动错误脱敏](2026-10-16-desktop-startup-error-redaction.zh.md)记录结构化启动诊断。

## 考虑过的替代方案

**从更新器 message 中移除凭据后继续显示 message。** 不采用，因为更新器 message 格式不受控，也可能以其他形式暴露秘密。

**始终显示预期日志路径。** 不采用，因为写入失败时，界面会错误地声称详情已经保存。

## 影响

renderer 更新状态不包含更新器或恢复错误 message。用户看到本地化错误类型；只有日志成功写入时才显示路径，写入失败时则显示通用提示。日志写入成功时，`desktop.log` 会保留原始更新器错误和恢复错误，供诊断使用。

## 验证

更新协调器回归检查发布状态不含代理凭据或恢复详情，并检查日志函数收到原始错误。启动回归模拟 `EACCES`，检查后端状态、普通页、应急页和本地化更新弹窗。聚焦 Desktop spec 与 oxlint 均通过。临时泄露 message 和无条件附加路径的变更分别触发对应回归断言失败。
