# Agent Note: Native read-only workflow run display

Status: implemented

English | [中文](2026-10-14-native-workflow-readonly.zh.md)

## Problem

Native Session history includes workflow events, but its transcript needs the same phase identities, member order and terminal states as the Cordis workflow node. Native has no logical parent-child directory or address contract for member navigation.

## Decision

[ui-workflow-run](../../../../rsh/Programs/Web/client/ui-workflow-run/README.md) shares a props-driven view and durable event projection between its Cordis adapter and `./native` library. Native anchors each panel at the run-start sequence and retains ordinary tool cards. Only the owning step or turn closing permits inferred interruption. Member rows are read-only; Session seed/fork headers supply no logical child-navigation authority.

## Alternatives considered

**Copy the Cordis panel into Native.** This duplicates disclosure behavior and allows phase identity or member status semantics to diverge.

**Use seed/fork parent metadata for navigation.** Those records describe Session provenance and do not prove logical membership or address availability.

## Consequences

Cordis retains its existing live-child eligibility and focus-aware disclosure. Native presents the same durable run facts without introducing Host interfaces or execution writes. Child navigation remains deferred until its owning interface exists.
