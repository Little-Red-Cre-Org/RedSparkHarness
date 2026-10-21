# Agent Note：原生 ACP 一次性权限

Status: implemented

[English](2026-10-05-native-acp-permissions.md) | 中文

## 问题

ACP 自动化客户端需要兼容承载层的一次性权限通道，同时保留原生审批策略与 Session 审计的所有权。

## 决策

原生承载层仅为其执行器的精确根 Agent 与 Session 引用回答所选审批 Provider。已提交的工具更新先于标准权限请求。只有声明的 allow-once 值允许执行；执行器仍是唯一审计 writer。

协议库对出站请求采用协作式取消。待结算权限请求归连接所有，在 Session 关闭和恢复前后保持有界，并在对端答复或连接退出后排空。解释答复之前重新核对捕获的所有权与取消状态。

## 考虑过的替代方案

新建权限注册表或 Session writer 会重复原生权威。为一项取消的权限关闭整个连接会中断无关 Session。丢弃未结算的传输请求会隐藏待处理工作并允许累积。

## 后果

显式选择的原生 ACP profile 提供既有审批 Provider，并保留兼容默认配置。MCP 连接、问题征询与权限预设仍属于独立能力。
