# Agent Note: RedSpark repository automation

Status: implemented

English | [中文](2026-09-13-redspark-ci.zh.md)

## Problem

Upstream automation depends on private runner pools, deployment accounts, provider credentials and organization governance that this fork does not configure.

## Decision

RedSpark has a keyless client baseline on standard Linux and Windows runners. Build, type and client tests run on both systems; lint and documentation checks run on Linux. Workflow permissions are read-only and checkout does not persist credentials. Native addon, sandbox and filename workflows remain enabled. Repository settings disable the other upstream workflows without deleting their definitions or failure records. Re-enabling an integration requires reviewing its target accounts, credentials and runner requirements first.

Ordinary Dependabot version-update PRs have a zero open limit. Security alerts are unchanged. Branch cleanup closes unmerged dependency PRs and deletes their remote branches without merging dependency changes into main or retaining a local backup.

## Alternatives considered

**Disable all checks:** this hides code failures along with missing integrations. RedSpark retains an executable client baseline and independent native/sandbox checks.

**Rename upstream accounts and keep every job active:** branding cannot supply credentials or private runners. The upstream definitions remain references, including their failover and untrusted-PR protections.

## Consequences

The baseline gives RedSpark useful hosted checks without provider calls or deployments. It does not claim the exhaustive coverage, browser snapshots, SDK platform matrix or real-API assurance described by upstream CI notes. Existing upstream runner notes retain value for their preserved definitions; this note owns only the fork's activation policy.
