# Agent Note: Native tool approvals and questions use shared cards

Status: implemented

English | [中文](2026-10-12-native-human-interactions.zh.md)

## Problem

The Native conversation needs to answer Host tool approvals and user questions without importing legacy Client plugin registrations or maintaining a second presentation implementation.

## Decision

`ui-tool/native`, `ui-approval/native`, and `ui-user-questions/native` expose props-only card views. Legacy views adapt to the same approval and question presentation components. Native calls the existing `answerHuman` Host operation with the supported approval outcome or structured question answer; plan-review intent already travels on the question prompt.

The Native Host approval Provider accepts `allowed-once` and `rejected`, so the approval card offers those actions. The Host question answer API has no question-only cancellation operation, so Native question cards omit dismiss and plan-review cards omit `Chat about it`. The separate whole-turn cancellation remains available.

## Alternatives considered

**Import the legacy approval or question entries.** Those entries load Cordis plugin registrations and slots that Native cannot use.

**Copy the legacy card markup into Native.** That would split presentation and let legacy and Native cards drift.

**Add outcomes to the Native Host protocol.** The current Providers do not accept session-scoped approval or question-only cancellation; adding UI-only wire outcomes would claim behavior the Host cannot perform.

## Consequences

Native tool cards share legacy presentation and package-local English and Chinese copy through the generated `./native` aliases. Session-wide approval and question-only dismissal remain Host API gaps recorded in `/workspace/rsh-h2-notes/m2-host-needs.md`; Native does not advertise either action.
