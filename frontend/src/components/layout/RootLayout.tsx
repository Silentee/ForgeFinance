import { useState, useEffect, useRef, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function RootLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const mobileBarRef = useRef<HTMLDivElement>(null)

  // Close drawer whenever the route changes (user tapped a nav link)
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Lock body scroll when drawer is open (iOS needs overflow hidden on html too)
  useEffect(() => {
    if (drawerOpen) {
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
    } else {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
    return () => {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  // Track mobile bar height so PageHeader can offset its sticky position
  useEffect(() => {
    const el = mobileBarRef.current
    if (!el) return
    const update = () => {
      document.documentElement.style.setProperty(
        '--mobile-bar-height',
        `${el.getBoundingClientRect().height}px`
      )
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  return (
    <div className="flex h-screen bg-surface-950 grid-bg bg-grid-40 overflow-hidden">
      {/* Desktop sidebar (unchanged, hidden on mobile) */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm drawer-backdrop"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          {/* Drawer panel */}
          <div className="relative z-10 h-full w-64 max-w-[80vw] drawer-enter safe-left">
            <Sidebar />
          </div>
        </div>
      )}

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto flex flex-col">
        {/* Mobile top bar (hidden on desktop) */}
        <div
          ref={mobileBarRef}
          className="sticky top-0 z-40 flex items-center gap-3 px-4 bg-surface-900/95 backdrop-blur border-b border-white/[0.06] md:hidden"
          style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))', paddingBottom: '0.75rem' }}
        >
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-2 rounded-lg text-ink-300 hover:text-ink-100 hover:bg-white/[0.06] transition-colors"
            aria-label="Open navigation"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-7 h-7">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
              <svg viewBox="0 0 32 32" fill="none" className="w-3.5 h-3.5">
                <rect x="4" y="18" width="4" height="8" rx="1" fill="#f5a623"/>
                <rect x="10" y="12" width="4" height="14" rx="1" fill="#f5a623" opacity="0.75"/>
                <rect x="16" y="8" width="4" height="18" rx="1" fill="#f5a623" opacity="0.9"/>
                <rect x="22" y="4" width="4" height="22" rx="1" fill="#f5a623"/>
              </svg>
            </div>
            <span className="text-lg font-semibold text-ink-300">Forge Finance</span>
          </div>
        </div>

        {/* Page content with responsive padding */}
        <div className="max-w-7xl mx-auto px-4 py-4 md:px-6 md:py-8 animate-fade-in flex-1 w-full">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
