/** Codex app-server permissions supported by this unattended adapter. */
export type CodexPermissionMode =
  | 'never'
  | 'approve-for-me'
  | 'dangerously-bypass-approvals-and-sandbox'

/** Permission modes accepted by the unattended Codex product runner.
 * Each mode maps to the documented thread/start fields.
 */
export const CODEX_PERMISSION_MODES = [
  'never',
  'approve-for-me',
  'dangerously-bypass-approvals-and-sandbox',
] as const satisfies readonly CodexPermissionMode[]

/** Default to Codex's non-interactive approval policy without overriding sandbox settings. */
export const DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode = 'never'
/** Default grace period for managed Codex child-range disposal, in milliseconds. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000
