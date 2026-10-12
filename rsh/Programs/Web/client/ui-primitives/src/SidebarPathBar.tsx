/** Shared path row for file panes and Session details. */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import css from './SidebarPathBar.module.css'

/**
 * Render an absolute path beside owner-provided controls.
 * @param props - the path and optional controls displayed at its trailing edge.
 * @returns the clipped path row.
 */
export function SidebarPathBar({ path, children }: { path: string; children?: ReactNode }): ReactNode {
  const box = useRef<HTMLDivElement | null>(null)
  const text = useRef<HTMLSpanElement | null>(null)
  const { directory, name } = pathPartsOf(path)

  useLayoutEffect(() => {
    const outer = box.current
    const inner = text.current
    if (outer === null || inner === null) return undefined
    const apply = (): void => {
      if (inner.offsetWidth > outer.clientWidth) outer.dataset.sidebarPathClipped = ''
      else delete outer.dataset.sidebarPathClipped
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply)
    observer?.observe(outer)
    observer?.observe(inner)
    return () => { observer?.disconnect() }
  }, [path])

  return (
    <div className={css.header}>
      <div ref={box} className={css.path} title={path} data-sidebar-path>
        <span ref={text} className={css.pathText}>
          {directory !== '' && <span className={css.directory}>{directory}</span>}
          <span className={css.name}>{name}</span>
        </span>
      </div>
      {children}
    </div>
  )
}
