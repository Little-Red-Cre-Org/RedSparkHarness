# M3 workflow validation

Base: origin/main 7c15423eff5569180e3a9024277ab8397b26649e.
Node 24.19.0, pnpm 11.28.5, normal install and hooks.
No HANDOFF.md, plans/ui-port-plan.md or team/ handoff package exists in this environment.

Passed: full build; serial typecheck; serial lint (one existing unused directive warning in acp-child); doc-sync 35/35; Native graph; package dependency policy; export JSDoc; focused workflow suites 39 tests; Native shell/transcript suites 2 tests. Full GUI final: 416 files, 5609 passed / 1 skipped. Workflow package coverage: 100% in all four dimensions (38 tests). All Native application owners plus workflow: 89 behavior tests passed, but NativeTranscript per-file 100% thresholds failed (40.27% lines, 23.28% branches, 43.75% functions, 42.1% statements); this is unresolved and not claimed as baseline.

Official DSH_SNAPSHOT=replay pnpm run test:web: 91 failed files, 14 passed, 1 skipped; 31 failed tests, 34 passed, 318 skipped. Fixed Playwright Chromium executable is missing; its previously rejected download was not retried. See [official replay log](logs/web-official.log.gz) for every failure. These failures are not all attributed to baseline.

Separate system Chromium 154.0.8037.57 QA: Cordis workflow replay 3 tests passed. Existing Native conversation case fails before the workflow block at the Model menu click timeout. A separate real built CLI/Host replay loads snapshots/session/workflow-run/session.v3.jsonl; the fixture supplies its recorded system prompt and admits the workspace through workspaceRoutes. This verified one completed run, one ordinary workflow tool card and zero member navigation buttons, then captured wide and narrow screenshots. No model request is submitted.

Hygiene failures reproduced independently on clean origin/main: 35 UI i18n findings (onboarding, native sidebar/rightbar); 5 archify optional imports; missing tool-subagent dependency in the Cordis bundle/rsh manifest. Duplication: 95 clones on both branch and clean main, none in changed workflow files. See the paired main logs under [logs](logs/).

Screenshots are runtime captures, not static mockups: native-workflow-history.png, native-workflow-narrow.png, cordis-workflow-history.png.

Transient concurrent checks were not treated as successful: build initially lacked Node development headers; installing a complete official Node 24 distribution fixed that. Running exhaustive browser scenarios alongside build readers produced missing CLI/declaration artifacts; the host declarations were rebuilt and serial typecheck passed. One concurrent lint process was SIGKILLed; serial lint passed.

PR: https://github.com/Little-Red-Cre-Org/RedSparkHarness/pull/228 (draft). Normal push and pre-push typecheck passed. Remote HEAD: 18a305983ef18579c86e885ca72abffa78d7755e. CI started: run 38540167147. No merge performed.

## Source identity and evidence-only publication

The initial implementation checkpoint is `18a305983ef18579c86e885ca72abffa78d7755e`; its normal pre-push typecheck ran after that commit and passed. The historical full build, serial lint/typecheck, doc-sync and final GUI runs occurred on the pre-commit working copy before `203f345510d0c512a5236082e827fd8c10d404a1`. The final workflow coverage and all-owner coverage ran on the working copy based on `203f345510d0c512a5236082e827fd8c10d404a1` containing the changes then committed as `18a305983ef18579c86e885ca72abffa78d7755e`; they are not post-commit full-suite runs. A separate exact immutable WIP tree was not recorded. The evidence publication commits after `18a305983e` contain only `.github/pr-evidence/native-workflow/`; they do not establish new full-suite passes.

The screenshots also predate `203f345510` and use earlier WIP built Client artifacts. In particular, their Native transcript bundle lacks the later session-level run-start fallback. They substantiate the ordinary-turn history panel and shared Cordis display, not the session-level fallback or a full final-HEAD browser pass. [screenshots.json](screenshots.json) records exact PNG hashes and this limit.

The Model menu timeout has **not** been reproduced on an exact checkout of main `7c15423eff5569180e3a9024277ab8397b26649e`. The recorded system-Chromium run is branch WIP, before the newly added workflow history block, at `getByRole('menuitem', { name: /^Model\b/u }).click()`: the button repeatedly detached, and the click timed out after 30000 ms. It is unclassified, not established baseline. The clean-main reproductions apply only to the three named hygiene checks and duplication.

## Runtime capture provenance

The Native capture script is preserved verbatim as [qa-native.capture-source.txt](qa-native.capture-source.txt). It creates a temporary `/tmp/rsh-web-profile-*` home, a `work/` workspace, `profiles/native-web/` with the shipped Client roster and a local deterministic `native-web-fixture-model`, and JSONL storage at that home's `sessions/`. It loads the existing recorded workflow parent, replaces its opaque ids and cwd with fixture identities, retains its `{{system}}` text, appends an explicit title event, and uses the real `JsonlSessionBackend.create/append/flush/close` API before starting the Host. The storage adapter computes the physical per-project Session path; the temporary home was removed after capture, so the original random directory suffix is not retained.

The launched application is the real built `rsh/Programs/CLI/lib/bin.js --profile native-web`, with `DSH_HOME` pointing at that temporary home and a fixed-clock import. The fixture config uses `systemPrompt: '{{system}}'` to match the historical record and `workspaceRoutes: { maxRoutes: 2, allowedRoots: [workspace] }` to admit its stored workspace. Selecting the stored Session goes through real Host controls/history RPC, then the script expands run and phase disclosures and captures at 1365×900 and 560×900. Chromium is explicitly `/usr/bin/chromium`. No task is submitted and no model stream or paid provider is called. This is restored-history acceptance, not live workflow execution.

The Cordis capture comes from the real Host `workflow-run.e2e.ts` keyless scenario, using `snapshots/session/workflow-run/session.v3.jsonl` and `session.1.v3.jsonl` via the existing replay scaffold. The temporary [browser configuration](m3-browser-config.mts.txt) and [system browser override](m3-system-browser.mjs.txt) are retained. The workflow file passed three tests; the same invocation's Native conversation file failed earlier at the Model menu. [browser-system-retry.log](logs/browser-system-retry.log.gz) records both outcomes. None of these system-Chromium runs is an official pinned-browser replay pass.

## Independent CR P2 repairs

The latest implementation source commit is `1eb5ae8518df47614a5265da4e0e358dd4a84157`. Independent CR confirmed two P2 defects: session-scope run B could be moved before a preceding turn's tool card by the shared synthetic turn 0 bucket, and workflow disclosure state could carry between Sessions with equal turn/run-start sequences. The repair uses ordered consecutive display segments, keeps session-scope runs without an owning turn, and includes Session id in panel identity. No Core, Host or protocol changes are made.

With the new tests and the transcript module restored to exact old source `18a305983ef18579c86e885ca72abffa78d7755e`, three regressions fail (order, running-state switch, completed-state switch); one prior regression passes. Restoring the repair passes all 92 cases across the 14 owning test files. A separate focused run after committing `1eb5ae8518df47614a5265da4e0e358dd4a84157` passes all four cases on that immutable source HEAD. See [negative control](logs/p2-negative.log.gz), [owners](logs/p2-owners.log.gz), and [exact-source run](logs/p2-exact-source.log.gz). The repair's normal commit hooks, export JSDoc, Markdown links/wrap, Agent Note format/classification and bilingual pairing checks pass. The earlier full-suite evidence and screenshots are unchanged and are not reruns on this repair.

The separate evidence publication follows `1eb5ae8518df47614a5265da4e0e358dd4a84157` and changes only this evidence directory. Its commit hash is reported in the handoff instead of self-referencing inside its contents. Current CI and independent rereview remain with the parent agent.

The original logs are stored as lossless gzip files to preserve terminal whitespace while satisfying repository whitespace hooks. [logs-manifest.json](logs-manifest.json) records hashes of both original and compressed bytes; decompress them for inspection. No check outcomes were edited.
