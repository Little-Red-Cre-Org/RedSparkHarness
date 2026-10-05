# Agent Note: Native TUI Session browser

Status: implemented

English | [中文](2026-10-05-native-tui-session-browser.zh.md)

## Problem

An interactive terminal needs to restore stored conversations without process restart or another Session writer.

## Decision

The selected persistence Provider lists Session identities in the configured workspace. The terminal admits discovery and restore only while idle without a pending human request, using the same cancellation and drain interval as model controls. Human requests cancel selector work and dismiss visible menus without submitting their selection input as an answer. The existing executor opens the selected Session and its bounded history reader supplies validated events.

The controller changes its selected identity and transcript only after restore succeeds. It reconstructs model observations from durable events and clears metadata belonging to the prior conversation. The renderer clears its view offset and retry input after accepted restore. Subsequent user input targets the selected Session; discovery and restore submit no model request.

## Alternatives considered

A terminal-local Session cache would drift from persistence. Opening a second writer would bypass the executor's ownership and maintenance admission.

## Consequences

Stored conversations in other workspaces are excluded. Restore errors preserve the selected transcript. Preset and permission controls, history scrolling and rich tool panels remain separate capabilities.
