---
description: "Native IDE integration backed by an external Code OSS workbench."
kind: "package-group"
---

# ide/ — Native IDE

English | [中文](README.zh.md)

## Summary

[ide-code-oss](ide-code-oss/README.md) provides a Code OSS workspace and extension host through the Native plugin system. The [native-ide application](../../../Programs/Web/host/native-ide/README.md) consumes it through a supported CLI profile.

## Table of Contents

- [Ownership](#ownership)
- [Dev Note](#dev-note)

## Ownership

The provider owns a local server process and its descendants through the [subprocess subsystem](../../../Docs/subsystems/subprocess.md). Code OSS owns editing, terminals, extension installation and activation. RSH does not load VS Code extensions into NativeHost.

## Dev Note

None.
