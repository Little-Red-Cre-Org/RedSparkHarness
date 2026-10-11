import type { ReactNode, Ref } from 'react'
import clsx from 'clsx'
import { Tooltip } from '../Tooltip.tsx'
import { IconCloseFill14, IconSearchOutline16 } from '../icons/index.tsx'
import css from './WorkspaceSection.module.css'

/**
 * Shared workspace section header with caller-owned search behavior and action controls.
 * @param props - Width, localized labels, search state, callbacks, and trailing controls.
 * @returns The workspace heading and the collapsed rail search control.
 */
export function WorkspaceSectionHeader({
  wide, label, searchExpanded, searchDisabled = false, query, maxLength, searchLabel, searchAriaLabel,
  placeholder, clearLabel, searchRootRef, inputRef, onSearchActivate, onSearchExpand, onQueryChange,
  onSearchClear, onRailSearch, actions,
}: {
  wide: boolean
  label: string
  searchExpanded: boolean
  searchDisabled?: boolean
  query: string
  maxLength: number
  searchLabel: string
  searchAriaLabel: string
  placeholder: string
  clearLabel: string
  searchRootRef?: Ref<HTMLDivElement> | undefined
  inputRef?: Ref<HTMLInputElement> | undefined
  onSearchActivate?: (() => void) | undefined
  onSearchExpand?: (() => void) | undefined
  onQueryChange?: ((query: string) => void) | undefined
  onSearchClear?: (() => void) | undefined
  onRailSearch?: (() => void) | undefined
  actions?: ReactNode
}) {
  return <>
    <div className={clsx(css.root, !wide && css.rail)}>
      <div className={css.sectionHeader}>
        {wide && <span className={clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>{label}</span>}
        {wide && <div className={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
          <div
            ref={searchRootRef}
            className={clsx(css.search, searchExpanded && css.searchExpanded)}
            onClick={searchDisabled ? undefined : onSearchActivate}
          >
            <Tooltip label={searchLabel} side="bottom" delayMs={500} disabled={searchExpanded || searchDisabled}>
              <button
                type="button"
                className={css.searchButton}
                aria-label={searchAriaLabel}
                aria-expanded={searchExpanded}
                disabled={searchDisabled}
                onClick={onSearchExpand}
              >
                <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
              </button>
            </Tooltip>
            <input
              ref={inputRef}
              className={css.searchInput}
              type="text"
              placeholder={placeholder}
              maxLength={maxLength}
              value={query}
              tabIndex={searchExpanded ? 0 : -1}
              disabled={searchDisabled}
              onChange={(event) => { onQueryChange?.(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                onQueryChange?.('')
                onSearchClear?.()
              }}
            />
            {searchExpanded && <button
              type="button"
              className={css.clearButton}
              aria-label={clearLabel}
              onClick={(event) => {
                event.stopPropagation()
                onQueryChange?.('')
                onSearchClear?.()
              }}
            ><IconCloseFill14 /></button>}
          </div>
        </div>}
        <div className={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>{actions}</div>
      </div>
    </div>
    {!wide && <div className={css.railSearch}>
      <Tooltip label={searchLabel} disabled={searchDisabled}>
        <button
          type="button"
          className={css.searchButton}
          aria-label={searchAriaLabel}
          disabled={searchDisabled}
          onClick={onRailSearch}
        ><IconSearchOutline16 size={18} /></button>
      </Tooltip>
    </div>}
  </>
}

/**
 * Render the localized empty state shared by grouped and flat Session lists.
 * @param props.label - Localized empty-state copy.
 * @returns The shared empty-state element.
 */
export function WorkspaceSectionEmpty({ label }: { label: string }) {
  return <div className={css.empty}>{label}</div>
}
