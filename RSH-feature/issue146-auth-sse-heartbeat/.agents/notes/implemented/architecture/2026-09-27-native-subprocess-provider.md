# Agent Note: Native local subprocess Provider

Status: implemented

English | [中文](2026-09-27-native-subprocess-provider.zh.md)

## Problem

The local subprocess Provider owned process containment and teardown inside a Cordis `Service` subclass. A native Host could not install it without loading Cordis, and the child-environment helper imported the legacy service entry. The low-level Win32 process package also declared a Cordis peer despite having no Cordis source dependency.

## Decision

[`dsh-subprocess`](../../../../rsh/Core/subprocess/subprocess/README.md) exports the Cordis-free `SubprocessOperations` definition and child-environment helper from `./native`. [`dsh-subprocess-local`](../../../../rsh/Core/subprocess/subprocess-local/README.md) owns one local process controller shared by its Cordis adapter and native Host Provider. Both entries use the same executable lookup, managed-range selection, PTY behavior, host-exit finalizer, and awaited teardown. The native entry rejects configuration because every process choice belongs to the spawn request. It reports weaker containment through a Node process warning; the Cordis adapter retains its logger warning. [`dsh-win32-process`](../../../../rsh/Core/subprocess/win32-process/README.md) no longer declares a Cordis peer, and the native dependency gate checks its source and required dependencies.

## Alternatives considered

**Duplicate the local process implementation for native Host:** this would give the two entries separate containment and teardown behavior, so fixes could leave one runtime with weaker process ownership.

**Wrap the Cordis Service in a native Provider:** this would retain Cordis in the native install and violate the independent production dependency check.

## Consequences

A native Host can register and stop the local subprocess service without importing Cordis. The built native definition and Provider pass an isolated Node import check that rejects Cordis resolution, and a native lifecycle test starts a real child and waits for shutdown. Existing Cordis consumers retain the same service methods and test hooks. The default headless profile is not switched by this change; remaining shell and search consumers must migrate before that profile can satisfy its full behavior checklist.
