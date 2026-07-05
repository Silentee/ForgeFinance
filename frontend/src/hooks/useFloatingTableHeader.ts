import { useCallback, useEffect, useRef, useState } from 'react'

// Horizontal scroll distance over which the frozen first column collapses.
const STICKY_COL_COLLAPSE_DISTANCE = 32

/**
 * Floating duplicate table header + collapsing frozen first column, shared
 * by the Spending report and the Budget page.
 *
 * - `showFloatingHeader` turns true once the real <thead> scrolls up behind
 *   the sticky page header — render a fixed copy of the header row then.
 * - Attach `theadRef` to the real <thead>, `tableWrapperRef` to the
 *   horizontally scrolling wrapper (with `onScroll={onTableScroll}`), and
 *   `floatingHeaderRef` to the floating copy's scroll container.
 * - `colCollapse` is 0..1 progress used to shrink the frozen first column
 *   over the first few px of horizontal scroll.
 * - `deps`: values that (re)mount the table, e.g. loading state, so the
 *   scroll listener re-attaches when the real header appears.
 */
export function useFloatingTableHeader(deps: unknown[] = []) {
  const theadRef = useRef<HTMLTableSectionElement>(null)
  const tableWrapperRef = useRef<HTMLDivElement>(null)
  const floatingHeaderRef = useRef<HTMLDivElement>(null)
  const [showFloatingHeader, setShowFloatingHeader] = useState(false)
  const [colCollapse, setColCollapse] = useState(0)

  useEffect(() => {
    const thead = theadRef.current
    if (!thead) return
    const scrollParent = thead.closest('main')
    if (!scrollParent) return
    const check = () => {
      const headerH = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--page-header-height') || '0'
      )
      setShowFloatingHeader(thead.getBoundingClientRect().top < headerH)
    }
    scrollParent.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    check()
    return () => {
      scrollParent.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // Sync the floating header's horizontal scroll + collapse the frozen column.
  const onTableScroll = useCallback(() => {
    if (tableWrapperRef.current && floatingHeaderRef.current) {
      floatingHeaderRef.current.scrollLeft = tableWrapperRef.current.scrollLeft
    }
    const p = Math.min(1, (tableWrapperRef.current?.scrollLeft ?? 0) / STICKY_COL_COLLAPSE_DISTANCE)
    setColCollapse(prev => (prev === p ? prev : p))
  }, [])

  useEffect(() => {
    if (showFloatingHeader && tableWrapperRef.current && floatingHeaderRef.current) {
      floatingHeaderRef.current.scrollLeft = tableWrapperRef.current.scrollLeft
    }
  }, [showFloatingHeader])

  return { theadRef, tableWrapperRef, floatingHeaderRef, showFloatingHeader, colCollapse, onTableScroll }
}
