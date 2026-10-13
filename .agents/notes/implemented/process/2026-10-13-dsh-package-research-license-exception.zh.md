# Agent Note: DSH 包研究许可例外

Status: implemented

[English](2026-10-13-dsh-package-research-license-exception.md) | 中文

## 问题

DSH 包许可检查要求所有 DSH 发布包都声明 MIT。`@deepseek-ai/dsh-acp-child` 发布包必须携带仓库的 RedSpark 许可文件，因此宽泛规则会拒绝它声明的许可。

## 决策

[`verify-dsh-package-licenses`](../../../../rsh/Scripts/verify-dsh-package-licenses.ts) 继续要求 DSH 包使用 MIT，只对工作区清单路径 [`acp-child/package.json`](../../../../rsh/Modules/Official/subagent/acp-child/package.json) 且包名精确为 `@deepseek-ai/dsh-acp-child` 的包识别一个例外。该清单必须声明 `SEE LICENSE IN LICENSE-REDSPARK-RESEARCH.txt`，在 `files` 中列出该文件，并随包提供与仓库根目录 [`LICENSE-REDSPARK-RESEARCH.txt`](../../../../LICENSE-REDSPARK-RESEARCH.txt) 字节完全一致的副本。保留路径上使用其他包名、在其他路径使用相同包名、声明被修改，或许可文件缺失或内容不同，都会使检查失败。

## 曾考虑的替代方案

- **将包声明改为 MIT**——不予采纳，因为这与包必须携带的许可文件不一致。
- **允许所有 DSH 包使用非 MIT 许可，或只按包名放行**——不予采纳，因为这会削弱其他包现有规则，且不会要求发布许可文本。

## 后果

其他 DSH 包仍须遵守 MIT 声明规则。仓库根目录 RedSpark 许可文本更新时，必须同步更新 ACP child 包副本，许可证检查才能通过。
