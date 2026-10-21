# Agent Note: Native search retains complete results through the selected spill Provider

Status: implemented

English | [中文](2026-10-05-native-search-and-spill.zh.md)

## Problem

Explicit native profiles need the existing filesystem discovery tools without loading the Cordis runtime. Capped search results must retain a readable complete-result locator, not lose the omitted matches.

## Decision

Compatibility and native Consumers share ripgrep acquisition, argument parsing, sampling, retention and formatting. Native registration uses selected Tools and subprocess Providers; cancellation and timeout await the process outcome. Native spill storage reuses the existing private local writes and cleanup routines through a framework-free Definition. The Consumer saves only accepted, unchanged direct results after result policies finish. The Session owner records the decorated text and search metadata before the next model request.

## Alternatives considered

Duplicating search execution would let parsing and output diverge between runtimes. Retaining only the unsaved-result footer would discard complete-result recovery. Loading the compatibility storage service would retain Cordis in the native dependency graph.

## Consequences

Explicit native templates install the local spill Provider; compatibility defaults remain unchanged. Search remains a process-backed local-workspace Consumer, not a remote filesystem implementation. The spill Provider drains saves and its startup sweep during disposal. Nested calls and policy-replaced results keep their accepted content without new spill artifacts. A saved locator can be searched through native grep; other filesystem Consumers enforce their own confinement. Client search-card rendering and general spill-result policies have separate migration owners.
