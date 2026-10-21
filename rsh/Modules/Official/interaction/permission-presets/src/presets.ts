/** Framework-neutral permission preset facts shared by Cordis and Native Providers. */
import type { NativeApprovalPolicy } from '@deepseek-ai/dsh-approval-definition'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox/native-types'

/** One sandbox/approval bundle and optional client presentation. */
export interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: NativeApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string | null
  /** One user-facing sentence on what the value means; omitted when not configured. */
  description?: string | null
}

/** Existing product defaults, consumed by both the Cordis and Native Providers. */
export const defaultPermissionPresets = {
  'workspace-write': {
    sandbox: 'workspace-write', approval: 'ask',
    name: 'workspace-write', description: 'Write inside the workspace and permitted temporary directories; wider retries require approval.',
  },
  'danger-full-access': {
    sandbox: 'danger-full-access', approval: 'never',
    name: 'danger-full-access', description: 'Full file access without approval prompts.',
  },
} satisfies Record<string, PresetSpec>
