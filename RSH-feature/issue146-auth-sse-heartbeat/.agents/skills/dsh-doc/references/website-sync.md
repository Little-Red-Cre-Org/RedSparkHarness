# Website publication

## Summary

The documentation website is a tested projection of repository Markdown, never a second copy. [rsh/Docs/website/docs.ts](../../../../rsh/Docs/website/docs.ts) is the explicit public allowlist, [rsh/Scripts/project-doc-site.ts](../../../../rsh/Scripts/project-doc-site.ts) rewrites mapped sources into the disposable `rsh/Docs/website/.generated/` tree, and VitePress builds that tree. The build also emits a raw-Markdown twin of every route and a root `llms.txt` index from the same manifest. This reference owns the manifest fields, the projector's link rules, preview and validation commands, and the deployment boundary.

## Table of Contents

- [Manifest ownership](#manifest-ownership)
- [Classify the change](#classify-the-change)
- [DocsPage fields](#docspage-fields)
- [Preserve link behavior](#preserve-link-behavior)
- [Preview and validate](#preview-and-validate)
- [Keep deployment separate](#keep-deployment-separate)
- [Dev Note](#dev-note)

## Manifest ownership

Read [rsh/Docs/AGENTS.md](../../../../rsh/Docs/AGENTS.md) and the current `DocsPage` type and entries in [rsh/Docs/website/docs.ts](../../../../rsh/Docs/website/docs.ts) before changing the manifest; do not rely on a remembered field set. Read [rsh/Docs/website/.vitepress/config.ts](../../../../rsh/Docs/website/.vitepress/config.ts) before adding a new section, sidebar collection, locale, or top-level navigation item. For an edited bilingual source, follow the lightweight routine path in [rsh/Docs/AGENTS.md](../../../../rsh/Docs/AGENTS.md#writing-rules) and the [pairing contract](../../../../rsh/Docs/i18n/README.md); never invoke the extended translation skill automatically.

Never edit or commit `rsh/Docs/website/.generated/`, `rsh/Docs/website/.cache/`, or `rsh/Docs/website/.dist/`. Except for `rsh/Docs/website/AGENTS.md`, never add Markdown under `rsh/Docs/website/`; locale and route directories such as `rsh/Docs/website/zh-CN/`, `rsh/Docs/website/en/`, and `rsh/Docs/website/api/` are invalid source layouts. Keep generated catalogs under `rsh/Docs/`, freshness-gate them there, and publish them through the manifest.

## Classify the change

- **Edit an already published page:** change only its canonical Markdown source. Do not touch the manifest unless its route or navigation metadata changes.
- **Publish a new page:** create it in its owning `rsh/Docs/` tier, then add one manifest entry.
- **Rename, move, or remove a page:** update the canonical file, manifest entry, and inbound repository links atomically. Remove stale manifest entries; `docs:check` rejects missing sources.
- **Publish a generated catalog:** map the generated `rsh/Docs/` file, but change its generator or source metadata rather than editing the catalog by hand.
- **Change site structure:** update the manifest for ordinary pages; update VitePress configuration only when the existing sidebar, section, or locale model cannot express the change.

Keep the manifest an explicit public allowlist. Do not publish RFCs, postmortems, testing guides, `AGENTS.md`, or maintainer workflows merely because they exist under `rsh/Docs/`; add internal material only when the user explicitly expands what the site publishes.

## DocsPage fields

Set every `DocsPage` field deliberately. The canonical field set and the `DocsSidebar` union live in [rsh/Docs/website/docs.ts](../../../../rsh/Docs/website/docs.ts) — read them there rather than copying values into prose; sections are owned by the `sections` record in that file, with no separate order list in the VitePress config.

- `source`: repository-relative canonical Markdown path. For a complete bilingual pair, add the English `.md` path through `pairedPages()`; it derives the sibling `.zh.md`, the content locales, and counterpart aliases.
- `route`: public VitePress path including the `.md` suffix.
- `label`: sidebar label, not necessarily the document H1.
- `sidebar`: reuse an existing `DocsSidebar` collection unless the information architecture genuinely needs another one.
- `section`: reuse an existing section when possible. If adding one, also define it in the `sections` record.
- `order`: stable order within the section.
- `sourceAliases`: optional additional repository paths that should resolve to this page when links are projected. It does not create another public route.

Use `mirroredPages()` only for a source that intentionally falls back to the same available language in both route trees. Convert that entry to `pairedPages()` when its counterpart is added. The site route trees are independent of the source layout: `foo.zh.md` projects to the root route and `foo.md` projects to the matching `/en/` route.

## Preserve link behavior

Write normal repository-relative Markdown links in canonical docs. The projector applies these rules:

- A target present in the manifest becomes a site-relative route.
- An existing target outside the manifest becomes a GitHub source link, including supported line suffixes.
- An image is the exception: its file is copied into the generated tree and referenced from there, so the site serves it regardless of repository visibility. It must be a regular file inside the repository.
- External URLs, site-absolute URLs, email links, and fragment-only links remain unchanged.
- A missing repository-relative target fails projection instead of silently producing a broken link.
- Cross-page fragments use the English GitHub heading id as their canonical id. If an authored heading emits a different VitePress id, place an explicit `<a id="..."></a>` immediately before it; add generated aliases in the owning generator.

Do not write website-specific routes into canonical Markdown just to satisfy VitePress. Use `sourceAliases` for directory-style repository links that should resolve to a mapped index page.

## Preview and validate

Run local preview while editing:

```sh
pnpm docs:dev
```

The dev server watches mapped source files and reprojects them. Restart it after changing the manifest if the new source is not picked up automatically.

Run the focused website gate before treating the mapping as valid:

```sh
pnpm docs:check
```

If Markdown link checks pass but the site build reports a missing fragment, follow the `verify-doc-site-fragments` source and target paths. Preserve the English GitHub id with an explicit alias in authored Markdown or in the owning generator.

If the build or `verify-doc-site-render` reports pages without server-rendered markup, the VitePress render failed while the build still exited 0; check first that `vue` and every `@vue/*` package resolve to one version (`pnpm why vue -r`, `pnpm why @vue/server-renderer -r`).

Before committing a documentation-site change, run:

```sh
pnpm run test:docs
pnpm run doc-sync
pnpm run lint
git diff --check
```

Use [dsh-pre-push-checks](../../dsh-pre-push-checks/SKILL.md) before pushing. Report the canonical files changed, manifest entries added or removed, public routes affected, and the exact checks run.

## Keep deployment separate

Synchronizing content into the VitePress build does not publish it to the internet. Do not add GitHub Pages permissions, deployment workflows, custom domains, or public hosting unless the user explicitly requests deployment and confirms the hosting policy.

## Dev Note

None.
