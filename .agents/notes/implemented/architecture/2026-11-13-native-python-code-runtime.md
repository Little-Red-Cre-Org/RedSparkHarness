# Agent Note: Native Python code runtime

Status: implemented

English | [中文](2026-11-13-native-python-code-runtime.zh.md)

## Problem

`code-runtime-python` could run only as a Cordis plugin. A Native composition therefore could not provide `codeRuntime` from this package. The implementation lived on a class that extends Cordis `Service`, and a Native source must not import `@redspark/cordis`.

## Decision

The package is mixed. `src/runtime.ts` owns the CPython subprocess runtime and imports neither Cordis nor `@redspark/rsh-code-runtime`. `src/index.ts` adapts that runtime to `CodeRuntime` and remains the default export. `src/native.ts` provides `codeRuntime` and registers the same teardown.

`run` accepts an optional `onStop`. It runs once when a spawned child is stopping, before the host waits for that child. A throw rejects the run. A request that returns before spawn does not notify. Cordis callers omit `onStop`, so their results stay the same.

The entry is not mounted on a shipped profile. A release package must not name this experimental package. [Native SDK persistent shell](2026-11-13-native-sdk-persistent-shell.md) leaves it unmounted.

## Alternatives considered

**Import the Cordis class from `native.ts`.** Native sources must not import `@redspark/cordis`, and that class constructor requires a Cordis context.

**Copy the runtime into `native.ts`.** Protocol handling, budgets, and teardown would diverge from the Cordis path.

**Mount the entry on a shipped profile in this change.** A release package must not name an experimental package. Choosing which composition carries Python belongs to the retirement plan.

## Consequences

Cordis callers keep `PythonCodeRuntime`, the same errors, and the same results. A Native host can install `@redspark/rsh-experimental-code-runtime-python/native` without Cordis. `onStop` is the Native stop notice and is absent from the Cordis request. The optional diagnostic field has shipped. The entry stays unmounted.

[fd-3 frame protocol](2026-07-31-code-runtime-python-fd3-protocol.md) records the wire this runtime speaks. [What still depends on Cordis](../../proposed/architecture/2026-11-10-what-still-depends-on-cordis.md) records the survey that named this gap. [Native SDK persistent shell](2026-11-13-native-sdk-persistent-shell.md) records why this entry stays unmounted. [Cordis retirement five phases](../../proposed/architecture/2026-11-12-cordis-retirement-five-phases.md) still owns mounting this entry. [Native external diagnostic](2026-11-13-native-external-diagnostic.md) records the field.
