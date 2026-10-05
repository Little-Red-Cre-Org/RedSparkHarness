# Agent Note: Native task lists derive from authoritative Session history

Status: implemented

English | [中文](2026-10-05-native-web-todo-panel.zh.md)

## Problem

Native Todo calls record whole-list snapshots, but the native conversation page previously displayed only append surface messages. Users could not see the standing task list during execution or after reopening a Session.

## Decision

The Todo package exposes a Cordis-free Client leaf with the same history fold used by its native Host reader. The fold validates durable list values, replaces the list on todo/write and clears it on canonical turn/start. Complete cold and fork-inherited history uses the same rule; turn/end retains the current list.

The native conversation page renders a read-only localized list from accepted Session events. It owns no task registry or write API. Live delivery and cold restoration keep their existing bounded transport and Session validation. The explicit native-web and native Desktop renderer share this view.

## Alternatives considered

A Client task registry would duplicate the Session authority and lose cold recovery. Clearing local state on Send would erase a valid list before Host admission. A new Host projection route is unnecessary because accepted durable events already carry the complete list.

## Consequences

Task statuses remain provider-neutral persisted values and presentation text remains locale-owned. The panel contributes no prompt, tool or model input. Task editing, richer tool cards and Sidebar navigation remain separate work; legacy default assembly is unchanged.
