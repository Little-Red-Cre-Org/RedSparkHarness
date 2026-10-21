# Agent Note: Materialize client combos when the graph is consumed

Status: implemented

English | [中文](2026-10-16-desktop-startup-combo-materialization.zh.md)

## Problem

Desktop startup loads client plugins incrementally. Rebuilding every combined script and indexed source map for each intermediate graph repeats string scans, serialization and allocations before a browser consumes any of those graphs.

## Decision

ClientModuleRegistry validates ordering and dependencies synchronously when records change, and retains the accepted table. The first graph or bundle request materializes that table's combo responses. Subsequent reads reuse the same graph and bytes until another accepted update. Invalid updates leave the accepted table intact, and the existing previous-batch response retention covers advertised URLs during reloads.

## Alternatives considered

**Node compilation caching** does not remove repeated combo assembly and did not improve the measured local startup path.

**Caching individual and completed batch artifacts** still rebuilds the growing application batch for intermediate graphs that have no reader.

## Consequences

The first reader pays one combo assembly; backend-ready time alone therefore does not measure the improvement. The local comparison includes fetching the index and every advertised initial plugin script through the Desktop byte pipes. It uses an isolated empty Harness home, makes no model request, and excludes browser paint. Existing module-registry checks cover malformed inputs, missing dependencies, cycles, immutable responses and source-map rebuilds. Memory retains the accepted table and materialized responses, rather than responses for unread intermediate startup graphs.
