# Agent Note: Native file-reference provider

Status: implemented

English | [中文](2026-10-09-native-file-reference-provider.zh.md)

## Problem

Native profiles need path discovery that uses the same filesystem namespace as their effective `read` tool, while preserving the Cordis provider and the single Native Session writer.

## Decision

`dsh-file-reference` owns the Cordis-free Native `NativeFileReferenceOperations` declaration, the shared search algorithm, grammar, and prompt text. The Native Host Provider in `dsh-native-file-reference-local` resolves the exact Agent and Session through `activeSessions`, reads directory metadata only through the selected `fs` service, and offers ranked path-only candidates. It contributes the shared guidance only when `read` exists in the Agent's scoped model schemas and any supplied Session `allowedTools` list permits it. Native Headless renders with the Session allowlist before publishing the active owner, then selects actual request schemas after attach so attach-time tools remain visible. Each active owner holds one bounded index; tool results invalidate that index, and detach cancels and drains its admitted reads before removing the Session listener. The Cordis provider keeps its existing service and host-filesystem adapter while reusing the shared search algorithm.

## Alternatives considered

**Search through the host Node filesystem.** This would allow discovery to disagree with a sandboxed or remote `fs` Provider. The Native Provider instead uses the selected `ctx.fs` implementation for listing, path resolution, metadata, and containment.

**Duplicate the search algorithm in the Native Provider.** This would let ranking and invalidation drift from the Cordis provider. The providers share the pure bounded search core and keep only their namespace-specific readers and lifecycle owners.

**Read candidate contents or attach them to the mention.** This would bypass the model-facing filesystem tool and its policy. Candidates remain path-only, and the model must call the effective `read` tool before using file contents.

## Consequences

Native and Cordis providers preserve their distinct runtime and filesystem ownership while sharing candidate ranking and prompt guidance. A Native profile without an effective `read` tool still has path discovery but receives no file-reading instruction. The selected provider's namespace and bounded exclusions determine which candidates appear.

## Verification

The shipped `workflow-native` CLI replay snapshot keeps FILE_REFERENCE_PROMPT in its system prompt and `read` in the emitted schemas. The Native provider test verifies stable candidates under reversed directory-entry order, guidance from the scoped `read` fallback, suppression under an empty Session allowlist, selected-filesystem containment, and detach draining. A Headless regression sets `allowedTools: []`: `read` stays registered but is absent from that request, the guidance is absent from both the request and durable system message, and the user's `@README.md` mention remains. A mismatched-prompt admission regression checks both fork and scheduled resume; the event stream is unchanged, with no persisted fork identity, interrupted-turn closers, or scheduled-origin marker. Existing task-scheduler cold-restore tests confirm attach-time `task_schedule` visibility for a direct human resume and continued denial for scheduled roots.
