import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'

/**
 * Return a directory basename for a workspace group, preserving roots without a basename.
 * @param cwd - Directory path, or undefined for the ungrouped bucket.
 * @returns The path basename, the path itself when it has no basename, or an empty label.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}
