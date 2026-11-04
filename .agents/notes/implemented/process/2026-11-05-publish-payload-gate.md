# Agent Note: Verify the packed publish payload resolves every specifier it carries

Status: implemented

English | [中文](2026-11-05-publish-payload-gate.zh.md)

## Problem

Three defects of one family pass every source-plane gate and only appear after `npm pack`:

1. A manifest advertises `exports["./native"].default` and the build never emits that file.
2. The file is emitted but the package's `files` list omits it, so the tarball drops it.
3. The file ships but imports a bare specifier declared only in `devDependencies`, which a consumer never installs.

`verify-native-build-output` covers the first two by reading the working tree for the rows of the two shipped compositions. That check cannot see a bare specifier at all: it deliberately scopes itself to relative targets, because relative specifiers are payload while bare specifiers are dependencies. Nothing read the bytes npm would actually publish.

The gap has a shape worth naming. Each defect is one step further from its cause than the last, and the reported failure is always a `MODULE_NOT_FOUND` at Desktop packaging inside `prepare-dsh`, naming an installation row rather than the package that is wrong.

## Decision

`rsh/Scripts/verify-publish-payload.ts` runs the real `npm pack` for every non-private workspace package whose manifest publishes `exports["./native"]` (176 packages at this commit), unpacks the tarball, and asserts that every module specifier in the payload resolves:

- **Relative specifiers** must resolve to a member of the same tarball. Because the payload is a flat member list rather than a file tree, resolution is a candidate match: the literal target, an added `.js`/`.mjs`/`.cjs`/`.d.ts`/`.json`, and a directory index.
- **Bare specifiers** must name a package the consumer installs: `dependencies`, `peerDependencies`, or `optionalDependencies`. A specifier found only in `devDependencies` is reported with that fact in the reason, because it is the specific mistake that shipped.

`node:` builtins and the package's own subpaths are not package relationships and are excluded before either rule applies.

### Exemptions are read from existing policy

A bare specifier needs no installing section when existing policy already says a module table answers it. Two sources are read rather than restated:

- `PLATFORM_MODULES` and `PRELOADED_CLIENT_EXTERNALS` from `rsh/Compatibility/DSH/web/frontend/src/platform.ts`, imported directly. The repository keeps these out of package manifests on purpose: baseline externals are implicit for every dynamic bundle and must not be repeated in manifests (`rsh/Programs/Web/client/AGENTS.md`, "Shared modules and the module graph"). Importing the constant means this gate cannot drift from the table it describes, and cannot drift if that table changes.
- The package's own `dsh.client.external` entries (`tsdown.client.ts` reads them into the same externals set). Such an exact request is answered by the dynamic row or a static table key, so it likewise installs nothing of its own.

The distinction the exemption preserves is the one the third defect turned on: `react` and `@redspark/rsh-client-store` in a client package's `devDependencies` are legal because the module table supplies them, while `@redspark/rsh-host-open-in-app/shared` was not, because no table entry and no installing section answered it.

### Cost

One `npm pack` plus one `tar -xzf` per package. Measured on this checkout at 32 concurrent children: 176 packages pack in about 80–120 s wall clock, roughly 0.5–0.7 s per package amortized, against about 3.3 s per package serially (`npm pack` in a workspace package pays a fixed ~2.5 s npm startup that dominates the real work). The pool size is `RSH_PUBLISH_PAYLOAD_CONCURRENCY` or `availableParallelism()`. Extraction runs in Node rather than through a second child process per package, and reads a whole tarball as one file read per member.

Every `tar` invocation uses a staging-relative path. GNU tar reads a leading drive letter as a remote host, so an absolute Windows path fails with `Cannot connect to D:`; the release scripts' existing `tarballFiles`/`capture` helpers already use the relative form for this reason.

## Alternatives considered

**Extend `verify-native-build-output` instead of adding a gate.** That gate answers a different question against a different input: the two shipped compositions against the working tree. Bare specifiers were excluded from it deliberately and the module doc says so. Folding payload inspection in would make one gate read both the tree and a tarball, and would silently widen a gate whose scope is documented as "the rows of the shipped compositions" to every published package.

**Reimplement `npm pack`'s file selection statically.** `publint-all` approximates the publication view from `files` plus the packlist conventions, which is enough to lint a manifest. It is not enough to prove what a tarball contains: the third defect is precisely a disagreement between the two, and only the real pack settles it. `publication-payload.ts` already borrows this lesson for source and map members.

**Parse the tarball in-process instead of running `tar`.** A correct parser must handle GNU long names, PAX extended headers, prefix concatenation, and the several tar dialects npm can emit. The repository already runs `tar` from the release scripts, and a second hand-rolled parser would be an unaudited implementation whose gaps fail silently — reporting a clean payload for a member it never read. Using the system tar keeps one implementation.

**Report `devDependencies` bare imports for every package.** Some of them are correct, as the exemption section states. Of the 24 bare specifiers found only in `devDependencies` across this checkout's Native entries, 22 are module-table baseline rows across 10 Client packages and only the other 2 are defects. Reporting all of them would have made the gate wrong 11 times more often than right, and a gate wrong that often is turned off.

## Consequences

The payload plane now has a gate for the same defects the source plane kept missing, and it reported four real defects on its first run against a tree where every other gate was green.

Two of those four were fixed in this change. `ui-settings-general` and `ui-settings-plugins` advertised `exports["./native"]` and a `files` entry for `lib/native.js` while their `tsdown.config.ts` called only `clientBundle`, so the file was never built; they now call `staticLinkedLeaf` and publish `lib/**/*.css`, matching the five sibling packages that gained a Native half in the same commit (`5383af6b7d`). They are a live example of the first defect: the commit's own message says a package advertising `./native` without building it hands its consumer a path to nothing.

The other two required `CLIENT_RUNTIME_DEPENDENCIES` entries, which is the policy's reviewed mechanism for a Client package whose published Native leaf reaches a package it would otherwise declare for development only:

- `@redspark/rsh-client-ui-sidebar` → `clsx`. Its leaf imports `clsx` at runtime for class composition.
- `@redspark/rsh-client-ui-input-trigger` → `@redspark/rsh-file-reference`. Its leaf imports `@redspark/rsh-file-reference/grammar` for the trigger-detection predicate, the same bare import the sibling decision recorded.

Both are in the shipped `native-web` Client composition, so the exported `/native` entry is what the Desktop browser bundle resolves. `verify-package-dependencies` rejects these as `devDependencies`-only until the policy names them, and the policy's own docstring requires a source use — which `/native` supplies and which the entry now satisfies in the installing section the gate checks.

The gate is deliberately not in `ci-static`: that lane owns no build, and both payload gates read built `lib/` output. It joins `ci-windows-observational` beside `verify-native-build-output`, where the build belongs to the lane.

## Testing

`rsh/Scripts/verify-publish-payload.spec.ts` pins the detection boundary: a missing relative target reports, a present one passes, a directory index resolves, a bare specifier in `devDependencies` reports with its specific reason, one in each installing section passes, an unreferenced payload member does not report, and both module-table exemptions hold while a subpath of a platform module name does not. The corpus-selection predicate is pinned separately so a package without a Native entry stays out of scope rather than being implied.

The gate was verified against real defects rather than fixtures alone: dropping `lib/client/SidebarRoot.module.css` from `ui-sidebar`'s `files` raised the violation count from 2 to 3 with the exact specifier named, and moving `@redspark/rsh-util-values` out of `dependencies` raised it to 13 across `@redspark/rsh-session`'s nine emitted files. Reverting each returned the count.
