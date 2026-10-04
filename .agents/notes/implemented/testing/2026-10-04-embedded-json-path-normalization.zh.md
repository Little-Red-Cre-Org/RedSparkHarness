# Agent Note: 内嵌 JSON 路径规范化

Status: implemented

[English](2026-10-04-embedded-json-path-normalization.md) | 中文

## Problem

PTC 将非字符串值作为 JSON 文本返回。Windows 路径的分隔符在该文本中经过转义。逐个转换序列化后的反斜杠会使一个文件系统分隔符显示为两个，并阻止它与可移植的已记录路径比较。

## Decision

规范比较校验完整的内嵌 JSON 对象或数组，并扫描完整字符串 token。只有解码后匹配已知 cwd 写法的直接 `path` 值会被替换为 token、规范化并重新编码。比较保留其余 JSON 字节，包括格式与无关值。原生模式保留其既有分隔符表示。

## Consequences

模型接收的 JSON 结果保持不变，已提交的 Session 代际无需重写。解码后真实重复的分隔符仍保持重复。格式错误的 JSON 与引号内的伪字段不接受额外的 JSON 路径处理。规范化识别序列化表示，而不把不同的文件系统路径视为等价。
