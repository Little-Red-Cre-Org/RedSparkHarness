# Agent Note: Published declarations retain reviewed type dependencies

Status: implemented

English | [中文](2026-10-05-published-type-dependencies.zh.md)

## Problem

Llm public declarations refer to Attachment types. An independently installed consumer requires that dependency even when JavaScript erases the authored import. Classifying every erased source import as development-only contradicts the published declaration dependency.

## Decision

The package policy records only the Llm-to-Attachment published type relationship. The source scanner reuses the existing TypeScript import classifiers to observe non-runtime package uses. Expected npm sections retain reviewed, observed type dependencies as production dependencies without fabricating a JavaScript import or changing runtime identity rules.

Policy verification refuses unmanaged owners, unknown workspace dependencies, duplicate entries and registered relationships without an observed source type import. Runtime exports still follow their existing peer identity classification. All undeclared type relationships keep their existing development-only treatment.

## Alternatives considered

Moving Attachment to development dependencies would omit a dependency needed by published Llm declarations. Adding a runtime import would retain unnecessary JavaScript solely to satisfy the scanner. The explicit policy instead records the observed type dependency and rejects registrations without source use.

## Consequences

The Llm manifest and installed Attachment dependency remain unchanged. One dependency-section regression covers source classification and stale or unknown policy rejection. The source dependency check proves this classification; the workspace-linked NodeNext check remains auxiliary and does not establish independent installation. Packed installation acceptance retains its existing separate responsibility.
