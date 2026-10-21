# Agent Note: On-demand Native tool groups

Status: implemented

English | [中文](2026-10-10-on-demand-tool-groups.zh.md)

## Problem

Advertising every installed tool increases request size and exposes unrelated choices. Static scope restrictions cannot open capabilities during a Session or reconstruct which tools were visible to a later request.

## Decision

The [tool-groups plugin](../../../../rsh/Modules/Official/guard/tool-groups/README.md) supplies an initial tool list, a short group directory and `request_tool_group`. A grant records the originating Session and exact tool names. Native headless captures selection at each model request and persists changed request headers. Registry visibility governs schemas, program bindings and executor admission, including same-scope contributions. Builtin application tools are incompatible because they bypass that registry.

The current batch cannot consume its own grant. New and forked Sessions start with the initial selection; resumed Sessions reconstruct their own grants. Stable initial prompt sections avoid system-prompt drift across resume; request results carry added schemas. Group opening never replaces approvals or sandbox checks.

The registry copies initial capabilities into a Set at registration, so later caller mutations cannot widen the initial selection and visibility reads reuse that Set. Request selections publish only after every policy succeeds and remain isolated by Agent scope. Restoration intersects recorded grants with current group membership: adding a tool does not silently grant it, and removing a tool removes access on the next restored request.

## Alternatives considered

Manual mode switching adds user interaction to routine tool discovery. Automatic phase classification adds another inference decision and ambiguous rollback behavior. Schema-only filtering leaves direct and nested execution paths unrestricted. These alternatives are excluded from this implementation.

## Consequences

The optional plugin needs no new inference service or execution loop. Explicit grouping and installation order remain deployment responsibilities. Dynamic schemas can reduce initial tokens but can also add a model round and disrupt prefix caching. The local Native application checks and recorded CLI replay use an offline model; they do not establish paid-model savings or desktop visual acceptance.
