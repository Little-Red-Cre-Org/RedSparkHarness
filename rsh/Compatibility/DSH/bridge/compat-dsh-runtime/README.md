---
description: "An optional native host owns the shared Cordis Context used by selected DSH compatibility bridges."
kind: "package-reference"
---

# @deepseek-ai/dsh-compat-dsh-runtime

English | [中文](README.zh.md)

## Summary

`dsh-compat-dsh-runtime` is the opt-in Cordis host for the selected native DSH bridges. It creates one Cordis Context, installs the existing plugin host adapter, and mounts only named first-party plugins. Native installations that omit this package do not import the compatibility runtime.

## Configuration

The native plugin accepts no configuration. Cordis must be major version 4. Mount requests are limited to the first-party DSH filesystem providers, observation policy, filesystem tools, system prompt, and tool registry used by the supported bridges. Arbitrary package names are rejected.

Each mount is adapted through `dsh-plugin-host`, which owns the Cordis child Fiber and descriptor registration. Native bridge disposers await plugin removal; failed activation disposes the partially started child and propagates the activation error. Host shutdown then disposes and drains the shared Context.

## Known Limitations

- This package does not load a Cordis Loader profile, legacy application bundle, or arbitrary DSH plugin.
- It does not make Cordis optional for existing Cordis application profiles; profile composition must select this package only on the native compatibility path.
- The currently supported adapters cover the filesystem capability family; additional DSH plugins require explicit manifests, configuration mapping, and lifecycle tests.
