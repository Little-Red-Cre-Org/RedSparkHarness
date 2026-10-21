# AGENTS.md — Documentation website adapter

Follow the [root instructions](../../../AGENTS.md), the [documentation standard](../../../AGENTS.md), and the [documentation workflow](../../../.agents/skills/dsh-doc/SKILL.md).

## Keep documentation content out of this tree

`website/` owns only VitePress configuration, presentation assets, and the publication manifest. This file is the only maintained Markdown file in this subtree.

Keep canonical prose and generated catalogs in their owning `docs/` tier, then expose selected pages through [docs.ts](docs.ts). Never add locale, route, API, or copied documentation trees such as `rsh/Docs/website/zh-CN/`, `rsh/Docs/website/en/`, or `rsh/Docs/website/api/`.

The projector writes disposable Markdown to the ignored `rsh/Docs/website/.generated/` directory. Never edit or commit `.generated/`, `.cache/`, or `.dist/`.

Production builds remove the configured output directory after VitePress resolves the site configuration and before it writes files. They reject output whose lexical path or nearest existing parent escapes the real site root, and unlink a link-shaped output instead of traversing its target. Raw-Markdown emission then treats files produced by that build as occupied and never overwrites them.

The build also emits each route's raw-Markdown twin (with a parent-level alias per index route) and a root `llms.txt` index into `.dist/`, so a page's URL, minus any trailing slash, plus `.md` serves it as plain Markdown. Both derive from the publication manifest at build time; neither is ever a file in this tree.

Server rendering must emit page markup. VitePress logs a Vue render error instead of failing, so a split Vue runtime, such as an `@vue/server-renderer` from another release than `vue`, writes every page with an empty `#app` in a build that exits 0. The production build therefore fails when VitePress logs `vitepress data not properly injected in app` or the matching renderer error, and `docs:build` then runs [verify-doc-site-render.ts](../../Scripts/verify-doc-site-render.ts), which rejects a locale home whose `#app` holds no element and any other page, except the client-rendered `404.html`, without `.vp-doc` text. Keep `vue` and every `@vue/*` runtime, compiler, and renderer package on one version.

Run `pnpm docs:check` after changing this subtree; the gate rejects additional non-ignored Markdown under `website/`.
