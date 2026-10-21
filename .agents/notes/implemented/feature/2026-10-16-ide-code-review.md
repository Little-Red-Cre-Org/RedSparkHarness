# Agent Note: IDE code review before editor changes

English | [中文](2026-10-16-ide-code-review.zh.md)

Status: implemented

## Problem

Automatically opening every generated answer does not let users approve individual changes to existing code.

## Decision

The existing composer admission event captures editor text and selects read-only permissions before submitting the recorded prompt. The Desktop extension keeps proposed line blocks outside documents and applies only user-selected blocks through the editor. Accepted text and document version guard subsequent acceptance against intervening edits.

## Alternatives considered

**Write first, then review.** Reverting a rejected proposal can overwrite user edits and triggers file watchers before consent.

**Replace the whole file on acceptance.** Users need to keep only selected changes; independent line blocks retain the rest of the baseline.

## Consequences

The right sidebar owns the transient review. One complete-file answer is supported; multiple fences require a new answer. Restarting the extension drops unaccepted previews. Read-only is the existing Session permission preset and remains selected after the request; ordinary permission controls still apply. No Session format or agent loop changes are needed.

## Testing

Owner-local tests cover partial acceptance and discard, full acceptance, and stale document rejection. Existing answer extraction tests cover completed recorded turns. Desktop interaction checks cover the same user controls with a real editor.
