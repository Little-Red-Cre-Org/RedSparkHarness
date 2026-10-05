# Agent Note: 原生终端回答确切的人机请求

Status: implemented

[English](2026-10-05-native-terminal-human-interaction.md) | 中文

## 问题

原生终端轮次需要交互式工具审批与模型提问，同时保持唯一权限权威和 Session writer。

## 决策

终端向选定 approval 与 userQuestions Provider 注册回答者。只有自身确切的活跃 root Session 接收呈现。显式配置的有界 FIFO 拥有待回答输入；回答指明画面观察到的确切呈现，已取消或替换的请求拒绝迟到输入。审批只允许本次操作或拒绝；问题保留选项标签、多选与自定义回答。

## 考虑的替代方案

Ink 记录审计事件会引入第二个 writer。持久权限授权超出单次审批请求。内嵌部署目录或替代提问 registry 会复制既有能力。

## 后果

既有执行器记录审批 asked／decided 事件和模型可见提问结果。调用方取消、退出和 Provider 移除先释放待回答呈现，再等待已接受执行排空。人机请求期间的 Esc 保留未提交草稿。审批取消持久记录决定审计并传递借用 signal 的原始原因，不将普通取消变为权限拒绝。显式 native-tui profile 安装既有提问 Definition 与模型工具，并声明直接 resolver 依赖。旧默认装配不变。权限预设选择和专门 Plan 面板仍是独立 Consumer。
