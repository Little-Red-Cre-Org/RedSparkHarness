# Agent Note: Native Web human answers retain the root owner

Status: implemented

English | [中文](2026-10-05-native-web-human-interaction.zh.md)

## Problem

A running native Web turn can require a tool approval or a human answer. Durable transcript rendering alone cannot complete those Provider requests, and another UI execution registry would duplicate Agent and Session authority.

## Decision

The Web Program registers answerers on the selected approval and user-question Providers. Only its exact active root turns with a follow stream receive presentations. Root capture verifies application ownership before presentation and answer, including while another Web admission is pending for the same Session. Per-turn FIFO input is globally bounded by profile configuration. Answers carry authenticated Session, admission and presentation identities and recheck the live root writer. Cancellation withdraws pending input before execution settlement; stale answers cannot apply to successor owners.

Question-answer JSON validation is shared with the existing broker. The browser holds transient presentation data, choices and submission state. It does not append Session events. Existing tool consumers persist approval decisions and question results through the sole writer; cold restore renders those facts.

## Alternatives considered

Restoring pending input from durable history would accept obsolete requests. Polling status would not identify the exact Provider operation. A second Agent or Session registry would compete with the selected executor. The existing authenticated follow stream and control requests supply the required presentation and answers.

## Consequences

The explicit native-web template installs the existing question Definition and tool Consumer; legacy defaults remain unchanged. Failed answers remain editable. Approval input accepts only allow-once or reject. Owner removal and installation teardown release presentation promises before Provider drain. No separate presentation log or authority is introduced.
