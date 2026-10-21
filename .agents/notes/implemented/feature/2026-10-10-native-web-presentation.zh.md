# Agent Note: 原生 Web 会话界面

Status: implemented

[English](2026-10-10-native-web-presentation.md) | 中文

## Problem

原生 Web profile 显示没有样式的控件，也没有说明它与 IDE 的用途区别。手动打开的测试页看起来像未完成的 IDE 启动界面。

## Decision

保留现有原生会话控制器与 Host 组合。Client 包提供会话导航、欢迎页、聊天记录、输入框与设置页的作用域样式。语言字典标明网页会话用途，并说明编码入口。窄屏将导航放到会话上方。

## Alternatives considered

把所有 Web 访问重定向到 IDE 会失去独立 Web 访问。增加另一个应用或主题依赖会扩大局部界面改动。

## Consequences

Session 数据、模型请求与启动行为保持不变。Web Host 输出地址，是否打开浏览器由调用方决定。测试启动方必须在验证后关闭自己创建的浏览器与服务。此页面仍为对话界面，不提供编辑器，也不自动跳转到桌面应用。
