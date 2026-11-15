# Agent Note: Native workflow child selection

Status: implemented

English | [中文](2026-11-14-native-workflow-child-selection.zh.md)

## Problem

Opening a running workflow child called `session/mode-controls` before the page published that child. The controller resolved a delegated Session to the title route, then admitted it as a root owner. The child is bound to its parent's route and its invocation is `delegated`, so the read failed and the page stayed on the parent.

## Decision

A delegated active owner gets locked mode controls from `header.agentPreset` without reading events or taking root admission. Its permission controls are unavailable. `routeForSession` follows `header.parentSession` to the parent root route, with a visited-id guard against a parent cycle.

## Alternatives considered

**Admit the child through `executeSessionOperation` after fixing the route.** The live path still requires invocation `root`, so a delegated owner is rejected. Reading events also waits on the child's writer while its model stream is held.

**Change `select` to publish history before controls.** Later root operations would still use the title route for a child that is not a workspace member.

## Consequences

Selecting a running child can show its history without cancelling the child turn. Mode controls for that child are locked and do not report plan-mode state. Permission controls are unavailable until the child is a root owner. Other Session mutations still use the parent route and the root-admission path, so they do not apply a change to the child itself.
