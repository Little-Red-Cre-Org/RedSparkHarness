# Agent Note: Native workflow member navigation

Status: implemented

English | [中文](2026-11-14-native-workflow-member-navigation.zh.md)

## Problem

`NativeWorkflowRunPanel` passed an empty navigable list, so a running workflow child could not be opened from the run disclosure. The Cordis panel opens that child when the ordinary Session list shows a running subagent of the current Session.

## Decision

`navigableWorkflowMembers` is the shared eligibility rule: the member is running, the child id is in the ordinary list, the row origin is `subagent`, its parent is the current Session, and the list row is still running. The Cordis panel adapts `SessionListState`. The Native transcript adapts the Host session list and passes the resulting ids with `select`. A missing callback, or a missing id list, keeps the row non-interactive.

## Alternatives considered

**Treat every running member id as navigable.** That opens a child the ordinary list does not prove.

**Open the child from the subagent menu.** That menu disables a running child. The workflow row is the path that opens a still-running child.

## Consequences

Open appears only for a running member whose list row is a running subagent of the selected Session. Selecting it uses the existing `select` path. The Host returns locked mode controls for that delegated owner without root admission, so the page can publish the child without cancelling its turn. Rows that fail eligibility stay non-interactive.
