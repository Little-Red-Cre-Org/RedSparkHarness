# AGENTS.md — Vendored Packages

This directory contains source-vendored copies of the Cordis framework and its foundation libraries. See `rsh/Core/vendor/README.md` for the manifest, local-modification log, and the upstream sync procedure.

**Do NOT edit `rsh/Core/vendor/*/src/` files casually.** Every local divergence from upstream must be logged exhaustively in `rsh/Core/vendor/README.md` under "Local modifications." The `rsh/Core/vendor/*/tsconfig.json` files are the exception — regenerated to fit the monorepo build, and they may be touched for type-checking policy changes (e.g., `noImplicitAny`).

When changes are unavoidable, follow the sync procedure in `rsh/Core/vendor/README.md`.
