# Agent Note: One Native Web scaffold for the remaining browser scenarios

Status: proposed

English | [中文](2026-11-24-native-web-scaffold-and-scenario-migration.zh.md)

## Problem

[Desktop-only retires the browser Web deployment](../../implemented/architecture/2026-11-21-desktop-only-retires-browser-web.md) names the next change: retire the browser e2e lane, migrate or document each of the 32 `profile: web` scenarios, and remove `rsh-web-app`, `rsh-base`, and the Typert remote Web surface. That lane still boots the Cordis composition through `launchWebScaffold`, so every migrated scenario also pays a manual subprocess bootstrap.

Each shipped `native-*.e2e.ts` repeats the same eighty lines: create the Harness home, keep a subset of the shipped `native-web` rows, rewrite their config, link workspace packages, write a fixture model, seed a Session, and read the announced URL. Two of those files also stopped matching the client they test — `native-bash-abort-row` queried `[data-tool=bash]` and `[data-disclosure-row]` while the Native Bash card rendered only `data-sample`, and `native-skill-tool-row` still asserted the generic card after `ToolCard` started routing `skill` to `NativeSkillRow`.

## Proposal

`rsh/Programs/Web/application/tests/native-scaffold.ts` owns the bootstrap. `launchNativeWeb` keeps a chosen row set, applies the durable-path defaults (`session-controller`, `fs`, `sandbox-policy`, `credentials`, `storage`), installs a silent catalog model when the scenario seeds its history, seeds one Session through `JsonlSessionBackend`, boots `dsh --profile native-web` as a subprocess, and returns the open page. A scenario therefore states only its rows, its seed, and its assertions.

Two contracts are aligned with the shared disclosure vocabulary, so a migrated scenario queries one attribute set on either face: the Native Bash wrapper carries `data-tool="bash"`, and both the Bash card and the skill row carry `data-disclosure-row` when expandable.

`open-in-app-ssh` is the seeded worked example: it boots Native, seeds the shared fixture, asserts the empty catalog, and compares a re-recorded Native header golden. `message-actions` is the Host-route worked example: the transcript assertions stay on the page, while the branch point, the child id, and the child's inherited prefix come from `session/history` and `session/fork`.

`launchNativeWeb` also accepts `drop`, which removes a shipped row before the `keep` filter. A replayed turn needs it to replace the shipped `pi-ai` provider: that row and the replay row both provide `model`, and the runtime rejects the duplicate. `native-replay-turn` proves the seam end to end — `session/create`, `session/prompt` with a recorded fixture, then the shipped transcript renders the replayed answer.

## Native surface facts

These differ from the Cordis face and decide how a scenario's selectors move:

- The Native transcript is `div[class*="ChatPresentation_transcript"]`. `[data-chat-flow]` belongs to `ui-chat`, which the Native application does not mount.
- The Native composer is `textarea[aria-label="Message"]`. `[data-composer-input]`, `[data-input-scroll]`, and `[data-turn-process]` belong to `ui-conversation`/`ui-chat` and have no Native counterpart; the Native client renders reasoning and context rows inline instead of folding them into a turn-process disclosure.
- Native reuses the shared approval, question, and plan-review cards, so `[data-approval-key]`, `[data-question-key]`, and `[data-plan-review-key]` address the same elements on either face.
- Sidebar rows are flat `[role="treeitem"]` entries under the `[role="tree"]` labelled `Workspaces`; workspace groups and `Ungrouped` are rows, not row ancestors.
- The Native transcript renders Copy plus the registered message actions beside each settled assistant message. It has no branch action, and the sidebar row menu offers Archive and Delete only.
- `session/fork` mints a child that is not attached to the source Workspace account, so it lists under `Ungrouped`; cold-opening that child resolves its owning root route from the persisted `parentSession`, so selecting its row shows its own transcript.
- The `/` palette completes the draft with the picked name and never submits. Submitting a line whose name resolves in the Session catalog executes it as a Host command; any other text is a prompt.
- Command lifecycle rows render from the durable `command/run`/`command/done` pair. An idle Session has no follow stream, so the client re-reads history after a command settles instead of rendering the RPC result.
- A slash command that leaves pending inbox input, such as `/plan <task>`, starts the root turn that admits it. The Host admits that turn with a follow feed and answers the command RPC only after the turn's history baseline is set; the client then attaches to it by `session/status`. A command that starts no turn leaves the Session idle.
- The approval card shows the pending call's command or arguments below the tool name. The card renders above the composer, where the browser face places it.
- A refused command catalog read keeps the draft in the composer and surfaces the error; it never sends the slash line to the model as ordinary text.
- The Native `ToolCard` routes `present` to `NativePresentRow` and `ask_user_question` to `NativeAskQuestionRow`; every other call uses `NativeToolCard`, whose shared `ToolRow` carries `data-tool=<name>`. A dedicated row that exists but is not routed renders as a generic JSON card.
- `native-silent-model` registers the `standard` standing preset itself only when the kept rows omit it; the shipped template now carries that preset, so an unconditional registration is a duplicate provider.
- `launchNativeWeb` writes `credentials` into the fixture credentials document and `predecessor` as a released V2 generation, so a scenario can drive the credentials seam or observe the adjacent migration through the Host.
- Replay `paceMs` is a delay per chunk, not per response; a recorded tool-call response holds many chunks, so a value above a few tens parks the turn for minutes.
- `replay.providers` accepts a provider-owned `retryPolicy`, so a scenario can pin retry exhaustion without configuring the Native retry row, whose configuration must stay empty.
- A seeded Session resumes against the prompt the kept rows compose. A full-row profile composes the run-code section, so a seed whose system message records `Answer the user.` must keep the narrow row set.
- Settlement and follow are separate RPCs, so a turn can settle before its follow stream is taken. The Host keeps that settled turn until `follow` attaches or the Client detaches, and `follow` retires it on release; deleting it when settlement finishes makes the concurrent follow fail with HTTP 409.
- The browser Client multiplexes every JSON `/api` response onto `/api/connection/follow-bus`, so a scenario that inspects a follow baseline reads the shared NDJSON downlink's base64 `bytes` frames instead of a per-Session `/api/native-session/follow` response.
- An admission that does not await the baseline must still observe its rejection; otherwise a failed route resolution surfaces as an unhandled rejection.
- The approval card reads the pending call's text through `readCommittedEvents()`. An unreadable prefix omits that text rather than refusing the decision.
- The Native composer keeps the Queue/Steer gestures: busy Enter applies the configured default and Cmd/Ctrl+Enter the alternate one, and the toolbar exposes `Queue` and `Interject`. Pending rows carry `Queued`/`Interjecting` tags and `Edit pending message`, `Interject instead`, and `Delete` actions.
- The Native composer stays enabled while a turn runs, so an enabled message box does not mean the turn settled. A transcript golden needs the Stop seat to retire and every attachment thumbnail to finish loading before it reads the records.
- Native has no pending-steering transcript bubble and no empty-draft flush that steers every queued message; a pending steer is visible only in the `Pending messages` row until the turn admits it.
- The Native transcript renders every user message through `ChatPresentation_userBubble`, whose text node and inner span both match an exact-text locator; count the bubbles instead of the text nodes.
- The Native replay adapter duplicated the scripted stream loop and dropped the hang sidecar's `readyFile`. Both adapters now call `replayEntry`, so a hang entry writes its marker for Native tests too.
- The shipped Native Web profile names the three permission presets (`read-only`, `workspace-write`, `danger-full-access`) in its composition, matching the Cordis base bundle. Without the `read-only` entry the Native app cannot return a Session to the sandbox mode it starts in.
- A Native mutation asks the session owner before the sandbox runs. In read-only mode the first write is approved and then denied, and the escalation retry raises a second request; a scenario must answer both.
- Cancelling a Native turn retires the abandoned partial from the live transcript while the durable assistant stream keeps it.
- The Native transcript has no turn-error row and no retry chain: a failed turn settles with no transcript message unless the failure is a transport error, which renders the client's `ConversationError` card.
- The Native transcript renders the per-message feedback action row, but activating a rating rendered no dialog and issued no Host request in the shipped build.
- A Native Models editor sends the namespace revision of the document read that was current when it opened. The page re-reads that document on every pushed invalidation, so an editor opened after another write carries that write's revision.

## Retired scenarios

No `snapshots/web/` directory selects `profile: web`: sixteen manifests moved to `native-web`, sixteen were retired, and `seeded-history` stays as the shared fixture owner with its recorded Session files.

Also moved to `launchNativeWeb`: `approval-composer`, `feedback-command`, `message-actions`, `message-feedback-protocol`, `open-in-app-ssh`, `plan-review`, `present-svg`, `preset-migration`, `pwsh-terminal`, `question-composer`, `steering`, and `web-search-round`.

Migrated with a Native test:

- `permission-policy-context` switches all three standing policies through the composer control and answers the escalation on the shared approval card.
- `feedback-release` drives `/feedback` and the `feedback/message-*` Host routes and compares the collector's released prefixes. The per-message rating dialog is bypassed: activating a rating rendered no dialog and issued no Host call, so the judgment goes through the route the dialog would submit.
- `fresh-round-trip` keeps the recorded prompt, the real Bash call, and the settled transcript. The Cordis turn-process disclosure, system-prompt extension, and `RSH_WEB_URL` probe retired with the browser deployment.
- `live-interactions` covers cancel (hang sidecar), AUTH failure, retry recovery, and retry exhaustion from the durable log. The Native transcript has no turn-error row, retry chain, or frozen abandoned partial, so those assertions read the canonical events instead.
- `models-settings-recovery` keeps a drifted `openrouter` route beside healthy providers, adds `minimax-cn`, rejects an edit that still names the unknown model, and removes the obsolete model.

Retired as recorded blockers, with their `profile: web` manifest and goldens removed:

- `background-job-list`: the Native application does not mount `NativeJobListAction`, and the Host has no route that cancels a Job.
- `subagent-conversation`, `subagent-interrupt`: the Native sidebar has no child-Session tree and the transcript has no addressed-conversation view.
- `workspace-management`: the Native client has no rename, delete, flat-list, hover card, or archive gesture for a Workspace.
- `document-preview`, `navigation-panes`, `details-session-lifecycle`, `sidebar-scrollbar`: the Native application has no right-sidebar document surface, trajectory pane, per-Session sidebar, or session-list scrollbar gutter.
- `file-upload-round`: the Native composer accepts images only.
- `turn-tail-actions`, `goal-multi-turn-actions`: the Native transcript has no turn-process disclosure, Compact/Normal switch, usage expansion, or branch action; settled message actions are covered by `native-message-actions`.
- `queued-image`, `plan-narrow-viewport`: they belong to `queue-image.e2e.ts` and `plan-control-row.e2e.ts`, whose other assertions read `ctx`.
- `steering`'s empty-draft Cmd+Enter flush that steers every queued message has no Native composer gesture; the other two steering paths are migrated.
- `queue-actions`: a new explicit prompt does not advance the preserved next-turn queue. The stopped turn keeps its queued messages, the waking prompt runs alone, and the queue stays pending; the Cordis loop drained the queue before that prompt.

`seeded-history` retired its goldens but kept `session.v2.jsonl` and `session.v3.jsonl`: that recorded Session is the seed `native-message-actions` and `native-open-in-app-ssh` reuse. Its turn-process disclosure, right-sidebar preview, and in-process context append have no Native counterpart.

`bash-abort-row` now owns its recorded Session instead of borrowing itself, and declares `web-default` rather than the retired `acp-default` composition. `seeded-history` carries the `web-default` header pin and its prompt/schema sidecars: the recorded-session corpus requires one pinned representative per composition class, and the retired `fresh-round-trip` pin would have forced prompt/schema goldens into a Native test that no longer compares them.

`lifecycle-chrome` asserted Cordis frame chrome: `centerCol`/`footArea` geometry, the Kitsune hero, Lexical composer phases, the turn-process cache-hit badge, and the reconnect pill. The Native shell has none of those nodes; its model picker, theme, and language paths are covered by `native-conversation`, and plan mode by `native-question-cancel`.

## Follow-up

Deleting `rsh-web-app`, `rsh-base`, `gateway`, and `remotes` also deletes `launchWebScaffold`, which 36 files in `rsh/Programs/Web/application/tests/` still import (plus `scaffold.ts` itself), along with `stress-tests/reasoning-chunks.stress.ts` and `rsh/Tests/benchmarks/long-session-browser/long-session.bench.ts`. Those are shared-client presentation and host-integration scenarios rather than the recorded-session scenarios retired here: markdown, scroll, composer geometry, settings, onboarding, and the shipped-composition probes. They must move first — to the fixture-connection tier `native-browser-graph.spec.ts` uses, or to `launchNativeWeb` where a real Host is required. The stress case and the benchmark need a Native launch path or retirement of their own. The packages and that scaffold therefore go together in the follow-up change.

Each of the original 52 importing tests belonged to one of three groups; the first group and eleven recorded blockers are gone, and six of the Native migrations have landed.

- **Delete (5):** `bash-abort-row`, `minimal-preset.snapshot`, `ptc-round`, `skill-tool-row`, and `scaffold-hermetic`. The first four already pass as `native-*` twins; `scaffold-hermetic` tests the Cordis scaffold's own isolation and dies with it.
- **Native migration (26):** `agent-preset-authoring`, `agent-preset-selection`, `chat-continuous-conversation`, `chat-long-interactions`, `chat-scroll-contract`, `clickable-links-gallery`, `declared-reasoning`, `default-model`, `markdown-cjk-strong`, `markdown-images`, `markdown-inline-code-links`, `math-rendering`, `models-settings`, `onboarding-deepseek-config`, `onboarding-usable-provider`, `plugin-config`, `present`, `rail-search-expand`, `schedule-after`, `settings-chrome`, `skill-user-invoke`, `startup-auto-selection`, `streaming-fence-highlight`, `trajectory-virtualization`, `workflow-run`, and `workspace-new-session-folding`. Each surface exists on the Native face: the agent-preset settings section, the model and reasoning picker, the transcript and its markdown renderer, the declared-file rows, sidebar search, the schedule catalog, settings sections, injection rows, the trajectory pane, and workflow rows. Assertions that name Cordis-only nodes (`data-chat-flow-*`, `data-composer-input`, `data-turn-process`, the right sidebar, or dockkit) move to the Native node or retire with the browser chrome.
- **Recorded blockers (20):** `sidebar-right`, `sidebar-subagent-activity`, `message-feedback`, `remote-welcome`, `stats-paged-history`, `startup-rpc-budget`, `github-ready-review`, `composer-draft-scroll`, `composer-placeholder`, `composer-tab-geometry`, `markdown-wide-table`, `reference-composer`, `skill-invocation-policy`, `access-confirmation`, `produced-files`, `produced-file-mentions`, `goal-bar`, `goal-command-presentation`, `shipped-composition`, and `complex-history.perf`. Native has no right sidebar or dockkit pane, no child-Session tree, no working per-message rating dialog, and the non-loopback notice belongs to the retired browser deployment. Native also renders per-message token usage instead of a whole-session stats row and does not expose the `sessionStats` projection, while the Cordis client's cold-boot `settings/describe` budget does not describe the Native startup path. Its GitHub entry shares the selected Native listener instead of mounting an isolated ingress port, and signed ingress through a trusted rule is covered by `native-github-webhook.snapshot.ts`. The six presentation scenarios assert the Lexical composer, its chips, and the Cordis transcript and frame geometry. Their owner retires with the browser client; the Native composer is a plain textarea with its own height cap and HTML placeholder, and Native layout assertions would need their own tests rather than a port of these files. `access-confirmation` asserts the Cordis risk dialog, acknowledgement checkbox, and permission trigger's `aria-label`; Native applies a permission preset immediately, with no in-page confirmation and no labelled current value. `produced-files` reads the write-derived summary with its prefix budget and `+N files` remainder; Native renders only `deliverables/presented` declarations, so a write-only turn has no Native row. `produced-file-mentions` relies on the Cordis file-mention vocabulary that links a unique inline-code basename to its sidebar preview; the Native transcript passes none, so every mention stays inert code. `goal-bar` drives Pause, Resume, and Clear; the Native Goal strip is read-only, with phase, objective, and round progress but no action. `goal-command-presentation` asserts the human command-input bubble, its chip, and its typography; Native command rows render only the command name and settlement. `shipped-composition` describes a Web composition that no longer ships — Native rows and their config are covered by `native-profile-template.spec.ts` — and `complex-history.perf` is that client's opt-in cardinality benchmark; Native performance work needs its own inventory.

Delete the five duplicates first: they clear five directories that a Cordis and a Native test both consume. The component and Host tests come next, then the settings, onboarding, and markdown migrations, then the transcript, scroll, and workflow group, then the four recorded blockers, and finally the packages with the scaffold.

## Alternatives considered

**Port `launchWebScaffold` to Native behind the same interface.** Rejected for now. Its `ctx` member is the Cordis root that 25 scenarios assert against, so a Native implementation would satisfy the type and fail every one of those assertions at runtime.

**Record every remaining `profile: web` scenario as a blocker and retire the lane now.** Rejected. A recorded blocker is the exit for a scenario whose capability does not exist; most of these have a Native owner already and only lack the test.

**Keep per-file bootstraps.** Rejected. The duplication is already the reason two contract mismatches went unnoticed: each file re-derived the client expectations it happened to query.

## Acceptance criteria

- No `snapshots/web/` directory selects `profile: web`, and every migrated scenario passes under `RSH_SNAPSHOT=replay` while asserting `assertFixtureInventory(..., 'native-web')`.
- After the follow-up, `launchNativeWeb` is the only scaffold a `profile: native-web` scenario uses. Until then five directories stay dual-consumed: the Native test owns the manifest while a Cordis test still compares its own golden or reuses the recorded Session (`message-feedback-protocol`, `present`, `schedule-catalog`, `seeded-history`, `workflow-run`).
- `rsh-web-app`, `rsh-base`, `gateway`, and `remotes` are deleted together with `launchWebScaffold`, after the remaining scenarios in `## Follow-up` move.

## Risks

- A migrated golden is re-recorded, so it records whatever the Native client renders at that commit. Each refresh needs a read of the diff, not just a green run.
- A slash command settles without a turn, so its row appears only after the client re-reads history; a scenario that asserts the row without that read sees an unchanged transcript.
- A client that attaches to a command-started turn before the Host has published its active root owner is refused by route capture. The Host holds the command RPC until the turn's history baseline is set, so the attach always finds the owner.
- A connected view is still restoring when the workspace row appears; an Enter pressed before the composer leaves its pending-input mode queues the text as steering input instead of running the command line.
- A `session/fork` child does not join the source Workspace account and cannot be opened from the sidebar, so fork follow-ups need that path before their assertions can move.
