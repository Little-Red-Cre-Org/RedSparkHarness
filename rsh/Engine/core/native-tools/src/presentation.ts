/** Framework-free file diff vocabulary for Host presenters and Client views.
 * @module @deepseek-ai/dsh-native-tools/presentation
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/native'

/** Category a UI may use for a generic tool-call icon or treatment. */
export type ToolCallKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'

/** A model-facing file path and optional 1-based line to focus in a capable UI. */
export interface FileLocation {
  path: string
  line?: number
}

/** Provider-neutral pending call view shared by Native and compatibility tools. */
export interface GenericCallView {
  card: 'generic'
  /** Short, human-readable label shown as the pending call heading. */
  title: string
  /** Category for icon/treatment; defaults to `other` when omitted. */
  kind?: ToolCallKind
  /** Salient input for an expanded view; omit when no input should be shown. */
  rawInput?: unknown
  /** UI-facing content blocks shown with the pending call. */
  content?: ContentBlock[]
  /** Model-facing file paths and optional line locations for editor follow-along. */
  locations?: FileLocation[]
}

/**
 * A single-file change a tool is about to make, for a UI that renders inline
 * diffs. `oldText` is `null` for a new-file create (nothing to diff against);
 * an overwrite also uses `null`, because a call-time presenter has no access to
 * the file's prior content.
 */
export interface FileDiff {
  path: string
  /** Prior content, or `null` for a new file / an overwrite (no prior content available at call time). */
  oldText: string | null
  /** Content after the change. */
  newText: string
}

/** One matched line inside a {@link SearchFileMatches} group: its 1-based line number and text. */
export interface SearchLineMatch {
  /** 1-based line number of the match within its file. */
  lineNumber: number
  /** The matched line text, as the tool surfaced it (the per-line preview budget already applied). */
  line: string
}

/** One file's grouped content matches for a {@link SearchMatchesResultView}, in first-seen file order. */
export interface SearchFileMatches {
  /** The file the matches belong to (the model-facing display path). */
  path: string
  /** The file's matched lines, in output order. */
  matches: SearchLineMatch[]
}

/**
 * A completed content search (`grep`) rendered as a search card whose matches are
 * grouped by file, so a capable UI can list each file as an expandable group of
 * its matched lines. `shape: 'matches'` discriminates this variant from the path
 * variant ({@link SearchPathsResultView}) within {@link SearchResultView}. The
 * discriminant is `shape`, not `kind`, so it never collides with the
 * call category `kind` an icon-picking bridge reads off a call view.
 */
export interface SearchMatchesResultView {
  card: 'search'
  shape: 'matches'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  title?: string
  /** Matched lines grouped by file, in first-seen file order. */
  files: SearchFileMatches[]
  /**
   * Whether the tool capped the inline result: `files` carries only the retained
   * matches, not every match the search found. A UI shows a capped indicator so it
   * never presents a partial group as complete.
   */
  truncated: boolean
  /** Total matches the search found before capping (equals the retained count when not `truncated`). */
  total: number
}

/**
 * A completed path search (`glob`) rendered as a search card whose result is a flat
 * path list. `shape: 'paths'` discriminates this variant from the grouped-matches
 * variant ({@link SearchMatchesResultView}) within {@link SearchResultView}.
 */
export interface SearchPathsResultView {
  card: 'search'
  shape: 'paths'
  /** Replacement title for the completed call. Omit to keep the pending-state title. */
  title?: string
  /** The discovered paths, in the tool's result order (the retained page when `truncated`). */
  paths: string[]
  /**
   * Whether the tool capped the inline result: `paths` carries only the retained
   * page, not every path the search found. A UI shows a capped indicator so it
   * never presents a partial list as complete.
   */
  truncated: boolean
  /** Total paths the search found before capping (equals `paths.length` when not `truncated`). */
  total: number
}

/**
 * A completed search rendered as a search card, the result-time view a discovery
 * tool (`grep`, `glob`) returns from `presentResult`. One `card: 'search'` view
 * with two `shape`-discriminated variants: grouped-by-file content matches
 * ({@link SearchMatchesResultView}) and a flat path list
 * ({@link SearchPathsResultView}). Both carry a `truncated`/`total` signal so a UI
 * never presents a capped result as complete. The view carries no result text: a
 * UI without a search card falls back to the raw `tool/result` content. There is
 * no call-time analogue: a search call stays a generic call view
 * (`kind: 'search'`) because the pending state has no matches or paths to show —
 * the structured shape exists only after `execute`.
 */
export type SearchResultView = SearchMatchesResultView | SearchPathsResultView
