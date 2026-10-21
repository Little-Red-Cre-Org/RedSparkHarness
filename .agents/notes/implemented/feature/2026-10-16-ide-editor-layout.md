# Agent Note: Code editors and task conversations occupy separate IDE regions

Status: implemented

English | [中文](2026-10-16-ide-editor-layout.zh.md)

## Problem

A conversation opened as the first editor tab occupies the space needed for writing code. File creation controls hidden until hover make the empty workbench difficult to discover.

## Decision

The Desktop adapter contributes a retained WebviewView to the Code OSS secondary sidebar. Code documents and recorded diffs use the first editor group. Explorer exposes New File and keeps its header actions visible by default. An empty editor group receives an untitled document; restored tabs remain intact. The existing Desktop message channel and save ownership remain unchanged.

## Alternatives considered

**A second editor group for conversation** still competes with file tabs and lets editor navigation replace the conversation. A sidebar gives the conversation its own hideable region.

**A custom editor and file tree** duplicate Code OSS editing, file creation and save behavior without adding a required capability.

## Consequences

The user can keep code and conversation visible together. New untitled documents require a destination when saved. Existing saved layout preferences remain user-owned. The focused adapter checks cover empty and restored editors, task delivery and workspace refresh; the isolated Code OSS smoke exercises file creation, central editing and disk saves without a model request.

Completed answer code uses the existing private message carrier and new unsaved editor documents. The Chat projection owns completion and interruption semantics; its initial completed turns establish a replay baseline. A Markdown parser extracts code from the final assistant message of each later completed turn, and the Desktop adapter validates the message before opening documents. No filesystem write or code execution is implicit.

The application menu requests the current selection from the primary renderer at click time, using the same draft validation as workspace menus. Desktop stores only the last directory path so reopening without a selected conversation does not restore stale drafts.
