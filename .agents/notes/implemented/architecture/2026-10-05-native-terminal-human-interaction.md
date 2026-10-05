# Agent Note: Native terminal answers exact human requests

Status: implemented

English | [中文](2026-10-05-native-terminal-human-interaction.zh.md)

## Problem

Native terminal turns need interactive tool approval and model questions without another permission authority or Session writer.

## Decision

The terminal registers answerers with the selected approval and userQuestions Providers. Only its exact active root Session receives presentations. A configured bounded FIFO owns unanswered input; responses name the renderer's exact presentation, so cancelled or replaced requests refuse late input. Approval grants one operation or rejects it; questions preserve option labels, multiple selection and custom answers.

## Alternatives considered

Writing audit events from Ink would introduce another writer. A permanent permission grant would exceed a one-shot approval request. A deployment catalog or replacement question registry would duplicate existing capabilities.

## Consequences

The existing executor records approval asked/decided events and model-visible question results. Caller cancellation, exit and Provider removal release unanswered presentations before accepted execution drains. The explicit native-tui profile installs the existing question Definition and model tool, with direct resolver dependencies. Legacy defaults remain unchanged. Permission preset selection and dedicated Plan panels remain separate Consumers.
