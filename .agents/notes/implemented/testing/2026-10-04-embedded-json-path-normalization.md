# Agent Note: Embedded JSON path normalization

Status: implemented

English | [中文](2026-10-04-embedded-json-path-normalization.zh.md)

## Problem

PTC returns non-string values as JSON text. A Windows path contains escaped separators inside that text. Converting each serialized backslash separately makes one filesystem separator appear as two and prevents comparison with the portable recorded path.

## Decision

Canonical comparison validates the complete embedded JSON object or array and scans complete string tokens. Only an immediate `path` value whose decoded path matches a known cwd spelling is tokenized, normalized and re-encoded. The comparison preserves the remaining JSON bytes, including formatting and unrelated values. Native mode retains its existing separator representation.

## Consequences

The model receives the unchanged JSON result, and committed Session generations need no rewrite. Actual repeated decoded separators remain repeated. Malformed JSON and quoted pseudo-fields receive no additional JSON-path handling. The normalizer recognizes serialization rather than treating distinct filesystem paths as equivalent.
