# Agent Note: Dependency advisory floors and the image signature gate

Status: implemented

English | [中文](2026-10-08-dependency-advisory-floors-and-image-signature-gate.zh.md)

## Problem

`pnpm audit` reported one critical and 48 high advisories against the lockfile. Two of them reach shipped behavior directly. Sharp releases before 0.35.5 carry libvips loader advisories that trigger while a format is being parsed, and attachment admission handed submitted bytes to Sharp without checking their container first, so libvips chose a loader, including HEIF/AVIF and SVG loaders, before the module rejected the format. The Desktop runtime also ships the pnpm version pinned in its manifest, and pnpm 11.7.0 is inside four pnpm advisories fixed by 11.11.0. The other findings came from direct ranges below their fixed releases and from transitive packages whose parents still lock vulnerable versions.

## Decision

Direct manifests require the fixed releases: `@modelcontextprotocol/sdk` ^1.32.1, `sharp` ^0.35.5, `compression` ^1.8.2, `undici` ^8.11.2, and `js-yaml` ^4.3.2 in every consumer, including the vendored Include manifest. The root `packageManager`, the native-system manifest, and the Desktop `pnpm` dependency pin pnpm 11.28.5, which is older than pnpm's default 1440-minute `minimumReleaseAge`.

`pnpm-workspace.yaml` overrides raise transitive packages only inside their vulnerable range of one release line, so no consumer crosses a major version. undici floors are scoped to the parents that lock the 6.x and 7.x lines (`node-gyp`, `@electron/get`, `@yao-pkg/pkg-fetch`, `e2b`, `jsdom`), and the MCP SDK floor is scoped to the two MCP reference servers used as mcp-client fixtures.

In `@deepseek-ai/dsh-attachment-local`, every Sharp pipeline opens through `openSupportedImage()`, which accepts only PNG, JPEG, WebP (`RIFF`/`WEBP`), and GIF87a/GIF89a leading signatures. Any other bytes fail with `INVALID_IMAGE` and the existing `Unsupported or malformed image data.` message before Sharp receives them. Admission, header probes, normalization, and request transforms share this function.

## Alternatives considered

**Version-range undici overrides such as `undici@>=6.0.0 <6.28.1`:** Rejected because pnpm applies a selector to every range that intersects it. The selector rewrote openai's `>=5 <9` peer range to `^6.28.1` and moved the workspace's undici 8 peer back to 6.x.

**Relying on the post-decode format check alone:** Rejected because libvips selects and runs a loader while reading metadata, so a rejection after `metadata()` comes after the vulnerable parser has already processed the bytes.

**Raising pnpm only to 11.11.0:** Rejected because later 11.x releases carry further fixes and 11.28.5 already satisfies the release-age policy.

**Upgrading vite in the documentation site, extract-zip, and e2b:** Deferred. The documentation site's vite 5 comes from vitepress 1 and needs vitepress 2, extract-zip has no fixed release, and the e2b fix is a major-version upgrade.

## Consequences

The full audit falls from 1 critical, 48 high, 50 moderate, and 12 low findings to 0 critical, 3 high, 23 moderate, and 5 low; the production audit has no high or critical findings. The remaining high findings are the documentation site's vite and Desktop's extract-zip. Each override must be removed once every parent requires the patched release.

Attachment bytes whose signature is not PNG, JPEG, WebP, or GIF are now rejected without decoder work. Bytes with a supported signature still pass through the full decode and the existing format check. Normalization tests that injected arbitrary bytes now prefix a supported signature to keep exercising encoder-failure mapping.

## Verification

`tests/signature.spec.ts` replaces Sharp with a recording wrapper. Valid PNG, JPEG, WebP, and GIF reach Sharp; SVG text, XML-prefixed SVG, HEIF and AVIF `ftyp` boxes, TIFF, non-WebP RIFF, truncated signatures, empty input, and random bytes fail with `INVALID_IMAGE` while Sharp records no call.
