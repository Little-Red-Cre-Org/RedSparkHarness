import type { NativeExternalJsonValue } from '@deepseek-ai/dsh-native-subagent'

/** Replace only this run's workspace root with the recorded-session cwd token. */
export function normalizeWorkspacePaths(value: NativeExternalJsonValue, cwd: string): NativeExternalJsonValue
