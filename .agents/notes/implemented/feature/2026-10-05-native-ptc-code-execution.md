# Agent Note: Native PTC code execution

Status: implemented

English | [中文](2026-10-05-native-ptc-code-execution.zh.md)

## Problem

Native programmatic tool calling needs real JSON-valued business tools, ordered durable dispatch and execution that respects the selected file policy. A worker alone supplies neither a model-facing tool nor OS confinement.

## Decision

The code tool registers `run_code` through NativeTools and uses its ordered PTC dispatcher for visible value tools. Jobs controls retain their model text and expose serializable values to programs. Prompt rendering accepts the requesting Agent scope so SDK declarations and executable bindings select the same tools. Headless explicitly selects built-in tools independently of registry contributions; the opt-in PTC composition uses only the registry path.

Confined execution uses a real subprocess Provider and the shared local sandbox backend. A private child delegates execution to the existing worker implementation. Native and Cordis sandbox installers share runner selection, file-policy construction and temporary-grant cleanup. Neither installer widens the platform backend’s documented enforcement strength.

The tool catalog selects each package's Cordis or native installation protocol. Native schema collection uses the actual tool Consumer and its selected Providers, closes its Host after collection, and retains rejection of missing packages and empty registrations.

## Consequences

The parent application remains the only Session writer. Nested dispatch records and outer results use the existing event payloads. Completion, failure and cancellation drain accepted dispatch before the outer invocation settles. A confined runtime never retries without its sandbox. Worker execution remains available for explicitly unrestricted compositions.

This opt-in composition does not change application defaults. Python requires a separately selected Provider; this batch supplies the TypeScript process Provider. File confinement does not imply network isolation, and partial Windows ACL enforcement remains partial.

## Alternatives considered

Parsing presentation text would invent program values. Another sandbox implementation would split runner and grant ownership. A second worker loop would duplicate execution behavior. Selecting registry tools from service presence would silently alter existing profiles.

## Verification

Publication checks cover built native entries and public NodeNext declarations. The focused product check launches an actual `dsh` profile, queries and cancels a real Agent-owned job through `run_code`, and inspects durable PTC facts. The confined process check executes a program and denies a file write through the real local backend. No permissive sandbox or echo tool supplies those capabilities.

The runtime notifies the caller to cancel bindings before draining accepted replies. Notification does not replace an existing timeout or exception with cancellation. A worker leaves the live set only after termination and pipe draining.
