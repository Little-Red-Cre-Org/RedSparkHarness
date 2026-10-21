# Agent Note: Native tool results retain one durable owner

Status: implemented

English | [中文](2026-10-05-native-tool-result-acceptance.zh.md)

## Problem

Typed program bindings need validated JSON while model tools need rendered content. Separate execution registries would disagree about scope, approval, cancellation and the point at which an outcome becomes a durable Session fact.

## Decision

The [tool registry](../../../../rsh/Engine/core/native-tools/README.md) shares registration and admission for model calls and program bindings. It captures output schemas, validates detached values, applies result policies and awaits finalizers. Every executor completion checks invocation cancellation, including the path without policies. Contribution removal cancels admission and waits for accepted work.

The [Headless application](../../../../rsh/Engine/core/native-headless/README.md) retains its existing Session writer. Tool-owned append callbacks serialize that writer's pending batches. A final tool result is persisted before its acceptance observers run; sourced extra inputs are separately logged before the next model request. A successful conclusion waits for the current batch to settle. Existing built-in filesystem and worker execution remain separate paths.

Legacy JSON Schema exports forward the same native implementation. Schema types retain one declaration, so the compatibility API referenced-type closure does not omit them as ambiguous duplicates.

## Alternatives considered

A value-only interface without a consuming application would not enforce durable ordering. A second writer inside the registry would compete with the application. Returning immediately after cancellation would release resources before an accepted executor settles. Reusing model rendering as canonical program JSON would make presentation changes alter binding values.

## Consequences

No Session event fields or format version change. The existing TypeScript and Python Session projections retain the same result and user-message records. PTC dispatch and SDK renderers are available, but a real code-runtime Consumer and process Provider remain a separate product batch. No default profile changes here.

## Verification

Three focused registry cases cover canonical values, contribution replacement drain and nested-call cancellation. The keyless tool-results scene launches the published dsh profile, derives replay from its selected recorded Session, checks persisted results before observer acceptance, compares prompt and tool sidecars, and verifies cold event and byte equality. TypeScript and Python notification parsers consume the same raw event projection; this does not prove a native SDK application launch. This batch does not claim a public PTC process launch or spill retention installation.
