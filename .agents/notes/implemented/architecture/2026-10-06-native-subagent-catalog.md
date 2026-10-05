# Agent Note: Native subagent catalog

Status: implemented

English | [中文](2026-10-06-native-subagent-catalog.zh.md)

## Problem

An agent needs to rediscover continuable children after its own turn and after process restart. A Provider-local child map loses cold children; an unscoped Session list may expose unrelated workspaces or sibling conversations.

## Decision

The selected Program scans its existing persistence corpus and constructs stable direct-parent paths within the initiating Session's workspace. Ordinary Sessions and one-shot children can carry a path, but only a final subagent candidate is inspected and returned. Inspection verifies every path edge, workspace and subagent delegation depth before the selected Provider folds the candidate's own descriptor; unreadable intermediates yield per-candidate diagnostics. The Provider returns only its continuable children, with actual Program Agent residency or a read diagnostic. A separate native tool registers `list_agents` over that Provider and the same Tools registry selected for continuation controls.

## Alternatives considered

Mirroring a Session catalog in the Provider creates another persistence authority. Using only the live Agent registry drops cold children. Treating a stored parent id as control permission would let discovery bypass direct-message admission.

## Consequences

The list is read-only and unpaginated. Direct children are message candidates; deeper entries require the control operation's independent authorization. A corrupt or unsupported candidate has a diagnostic row, while ordinary and one-shot intermediaries stay hidden. A stored status is an observation, not a promise that a later delivery succeeds. The shipped SDK and ACP profiles install the tool explicitly; settlement notices and a future `subagent.finished` wire event remain separate.
