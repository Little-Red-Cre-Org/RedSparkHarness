# Agent Note: RedSpark repository automation

Status: implemented

English | [中文](2026-09-13-redspark-ci.zh.md)

## Problem

Upstream automation depends on private runner pools, deployment accounts, provider credentials and organization governance that this fork does not configure.

## Decision

RedSpark has a keyless client baseline on standard Linux and Windows runners. Build, type and client tests run on both systems; lint and documentation checks run on Linux. Workflow permissions are read-only and checkout does not persist credentials. Native addon, sandbox and filename workflows remain enabled. Repository settings disable the other upstream workflows without deleting their definitions or failure records. Re-enabling an integration requires reviewing its target accounts, credentials and runner requirements first.

The [RedSpark workflow](../../../../.github/workflows/redspark-ci.yml) runs workflow regressions and source-only package publication rules before building. Lint and documentation checks run after type preparation and before runtime regressions and client tests, so static failures do not wait for those tests. Both source and packed Linux/Windows checks are required by main branch protection and its ruleset. Their existing job names are stable identifiers for those settings; a successful source build cannot replace the packed consumer verdict.

The packed jobs use the existing packer's bounded pool with four workers for the dsh family. Payload validation remains per tarball, and the recorded publish order follows the release dependency order regardless of completion order. Ordinary and official builds remain separate because their client profiles differ; credentialed publication retains its existing settings.

Native addon push checks and the sandbox matrix listen to `main`, the fork's default branch. Native addon pull-request path filters and the sandbox's post-merge platform policy remain intact. Disabled upstream workflows retain their reference branch and integration settings.

Ordinary Dependabot version-update PRs have a zero open limit. Security alerts are unchanged. Branch cleanup closes unmerged dependency PRs and deletes their remote branches without merging dependency changes into main or retaining a local backup.

## Alternatives considered

**Disable all checks:** this hides code failures along with missing integrations. RedSpark retains an executable client baseline and independent rsh/Core/native/sandbox checks.

**Rename upstream accounts and keep every job active:** branding cannot supply credentials or private runners. The upstream definitions remain references, including their failover and untrusted-PR protections.

**Keep serial packing or reuse the ordinary client build:** serial packing delays each platform's consumer verification; a small bounded pool reduces that work without changing the publish set. Reusing a different client profile would violate official artifact validation. Concurrency changes require equal tarball contents and publish order against a serial run before adoption.

## Consequences

The baseline gives RedSpark useful hosted checks without provider calls or deployments. Packed checks install tarballs into a fresh consumer outside the checkout and run the existing packed e2e on both systems. Sandbox platform failures are discovered after merge. The baseline does not claim the exhaustive coverage, browser snapshots, SDK platform matrix or real-API assurance described by upstream CI notes. Existing upstream runner notes retain value for their preserved definitions; this note owns the fork's activation and scheduling policy. [Workflow regressions](../../../../rsh/Scripts/ci-workflow.spec.ts) check main push routing and static-check ordering in the active Linux baseline.
