# Agent Note: Native tool approvals and questions use shared cards

Status: implemented

English | [中文](2026-10-12-native-human-interactions.zh.md)

## Problem

The Native conversation needs to answer Host tool approvals and user questions without importing legacy Client plugin registrations or maintaining a second presentation implementation.

## Decision

`ui-tool/native`, `ui-approval/native`, and `ui-user-questions/native` expose props-only card views. Legacy views adapt to the same approval and question presentation components. Native calls the existing `answerHuman` Host operation with the supported approval outcome or structured question answer; plan-review intent already travels on the question prompt.

The Native wrapper supplies the optional Session action only for `canAllowSession: true`, and sends `approval/allowed-session` through the existing Host answer API. Its question cancel callback reuses generic dismissal and plan discussion, sending `cancel-questions` for the entire pending batch. These actions leave scope admission and turn execution on the Host.

## Alternatives considered

**Import the legacy approval or question entries.** Those entries load Cordis plugin registrations and slots that Native cannot use.

**Copy the legacy card markup into Native.** That would split presentation and let legacy and Native cards drift.

**Derive permission scope in the browser.** The Host admits reusable scopes and validates presentation ownership; Client callbacks cannot expand that authority.

## Consequences

Native tool cards share legacy presentation and package-local English and Chinese copy through `./native`. Approval and plan actions wrap on narrow screens. Pending question dismissal cancels the batch rather than an individual draft or the turn. Failed acknowledgements release local busy state while retaining the prompt; delayed answer results cannot update a different Session or prompt. Only Host removal clears a presentation.
