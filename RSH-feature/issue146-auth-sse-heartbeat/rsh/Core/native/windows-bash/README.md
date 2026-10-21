# Windows Bash runtime sources

English | [中文](README.zh.md)

## Summary

This directory supplies an experimental MSYS runtime patch and build inputs for investigating Windows restricted-token Bash compatibility. It does not install Bash, replace system Git, or change the runtime selected by shipped Harness profiles.

## Table of Contents

- [Source preparation](#source-preparation)
- [Build inputs](#build-inputs)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

<a id="source-preparation"></a>
## Source preparation

[upstream.json](upstream.json) pins the source archive and patch hashes. [prepare-source.ps1](prepare-source.ps1) accepts an existing archive and a new destination, verifies both hashes before extraction, applies the patch, and returns the prepared source directory. Extraction or patch failure retains the partial destination for inspection; the script never replaces an existing destination. PowerShell, Git, and tar must be available on the build host.

<a id="build-inputs"></a>
## Build inputs

[build-runtime.sh](build-runtime.sh) accepts a prepared source directory and a non-existing build directory. It requires an MSYS toolchain, including the MSYS compiler and the MinGW cross compiler under `/opt/bin`. It checks that the patch is present, runs upstream autotools generation, and builds newlib and the runtime subdirectory. The patch-presence check is not a complete source integrity check; use the source preparation script with the pinned archive.

<a id="limitations"></a>
## Limitations

[prepare-distribution.ps1](prepare-distribution.ps1) assembles a new directory from the pinned PortableGit archive and a caller-supplied DLL. It verifies the archive, the original MSYS DLL, and the copied DLL bytes. The caller supplies a 7-Zip executable and must independently validate the replacement DLL; assembly does not establish its source provenance or security properties.

The toolchain packages are not locked or provisioned by these scripts. [Desktop packaging](../../../Programs/Desktop/README.md#package) consumes an explicitly prepared distribution; broader security acceptance and installer acceptance remain separate requirements. No binary from this directory is a released Harness dependency.

The patch adds an existing restricting SID to selected new IPC object ACLs. It does not change the token's restricting SID list or grant filesystem write access. Its coverage is limited to the modified upstream paths; it is not a general implementation of Windows restricted-token compatibility.

<a id="dev-note"></a>
## Dev Note

The [physical migration proposal](../../../../.agents/notes/proposed/architecture/2026-09-18-rsh-physical-layout-migration.md) owns the ongoing integration work and validation context.
