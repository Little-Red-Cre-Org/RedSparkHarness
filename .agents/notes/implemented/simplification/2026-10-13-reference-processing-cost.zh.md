# Agent Note: 避免重复处理引用

Status: implemented

[English](2026-10-13-reference-processing-cost.md) | 中文

## Problem

会话引用在丢弃旧消息时反复序列化所有剩余消息。文件补全则为每个候选重复转换同一个查询的大小写。

## Decision

[会话保留](../../../../rsh/Engine/context/session-reference/src/projection.ts) 先计算完整标签安全 JSON 的大小，再在删除或缩短消息时更新字节数。删除仍保护检查点和最新消息；截短与省略统计保留原有语义。[文件补全](../../../../rsh/Engine/context/file-reference-local/src/search.ts) 在候选评分前仅归一化一次查询。

## Alternatives considered

**反复完整序列化**能直接重新计算大小，但每丢弃一条消息都会重新编码未变的文本。逐消息字节差值保持相同预算，同时无需持久缓存。

## Consequences

删除期间不再反复序列化未变的消息文本。数组遍历与删除仍然存在，因此不承诺总运行时间为线性。标签转义、UTF-8 字节限制、完整快照及确定性搜索顺序保持不变。既有引用测试与三组转义字节边界用例验证保留输出和统计。
