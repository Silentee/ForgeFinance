import { useState, useEffect, useRef, type FormEvent } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useDemoStatus, useClearDemo, useStartDemo, useCurrentUser, useChangePassword } from '@/hooks'
import { exportApi } from '@/lib/services'
import { clearToken } from '@/lib/api'
import { Modal } from '@/components/ui'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 10a3.001 3.001 0 01-2 2.83V14a1 1 0 11-2 0v-1.17A3.001 3.001 0 017 10a3 3 0 013-3z"/>
      </svg>
    ),
  },
  {
    to: '/accounts',
    label: 'Accounts',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/>
        <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd"/>
      </svg>
    ),
  },
  {
    to: '/transactions',
    label: 'Transactions',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"/>
      </svg>
    ),
  },
  {
    to: '/budget',
    label: 'Budget',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>
      </svg>
    ),
  },
]

const REPORT_SUB_ITEMS = [
  { to: '/reports/net-worth', label: 'Net Worth & Equity' },
  { to: '/reports/cash-flow', label: 'Cash Flow' },
  { to: '/reports/spending', label: 'Spending' },
  { to: '/reports/emergency-fund', label: 'Emergency Fund' },
]

const REPORTS_ICON = (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm9 4a1 1 0 10-2 0v6a1 1 0 102 0V7zm-3 2a1 1 0 10-2 0v4a1 1 0 102 0V9zm-3 3a1 1 0 10-2 0v1a1 1 0 102 0v-1z" clipRule="evenodd"/>
  </svg>
)

const IMPORT_ITEM: NavItem = {
  to: '/import',
  label: 'Import',
  icon: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
    </svg>
  ),
}

export default function Sidebar() {
  const location = useLocation()
  const { data: demoStatus } = useDemoStatus()
  const clearDemo = useClearDemo()
  const startDemo = useStartDemo()
  const { data: currentUser } = useCurrentUser()
  const changePassword = useChangePassword()
  const [showConfirm, setShowConfirm] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', new: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const settingsRef = useRef<HTMLDivElement>(null)
  const isReportsActive = location.pathname.startsWith('/reports')
  const [reportsExpanded, setReportsExpanded] = useState(isReportsActive)

  // Auto-expand when navigating to a report URL directly
  useEffect(() => {
    if (isReportsActive) setReportsExpanded(true)
  }, [isReportsActive])

  useEffect(() => {
    if (!showSettings) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSettings])

  const handleEndDemo = () => {
    if (showConfirm) {
      clearDemo.mutate()
      setShowConfirm(false)
    } else {
      setShowConfirm(true)
    }
  }

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-surface-900 border-r border-white/[0.06] h-full">
      {/* Logo - fixed at top */}
      <div className="flex-shrink-0 px-5 py-6 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
            <svg viewBox="0 0 32 32" fill="none" className="w-4 h-4">
              <rect x="4" y="18" width="4" height="8" rx="1" fill="#f5a623"/>
              <rect x="10" y="12" width="4" height="14" rx="1" fill="#f5a623" opacity="0.75"/>
              <rect x="16" y="8" width="4" height="18" rx="1" fill="#f5a623" opacity="0.9"/>
              <rect x="22" y="4" width="4" height="22" rx="1" fill="#f5a623"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-ink-100 leading-none">Forge</div>
            <div className="text-2xs text-ink-300 mt-0.5 font-mono">Finance</div>
          </div>
        </div>
      </div>

      {/* Scrollable middle section */}
      <div className="flex-1 overflow-y-auto">
        {/* Nav */}
        <nav className="px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-amber-400/10 text-amber-400 border border-amber-400/15'
                  : 'text-ink-300 hover:text-ink-100 hover:bg-white/[0.04]'
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}

        {/* Reports with expandable sub-items */}
        <button
          onClick={() => setReportsExpanded(e => !e)}
          className={clsx(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
            isReportsActive
              ? 'bg-amber-400/10 text-amber-400 border border-amber-400/15'
              : 'text-ink-300 hover:text-ink-100 hover:bg-white/[0.04]'
          )}
        >
          {REPORTS_ICON}
          Reports
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={clsx('w-3 h-3 ml-auto transition-transform duration-150', reportsExpanded && 'rotate-90')}
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
          </svg>
        </button>
        {reportsExpanded && (
          <div className="ml-4 pl-3 border-l border-white/[0.06] space-y-0.5">
            {REPORT_SUB_ITEMS.map(sub => (
              <NavLink
                key={sub.to}
                to={sub.to}
                className={({ isActive }) =>
                  clsx(
                    'block px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150',
                    isActive
                      ? 'text-amber-400 bg-amber-400/5'
                      : 'text-ink-300 hover:text-ink-100 hover:bg-white/[0.03]'
                  )
                }
              >
                {sub.label}
              </NavLink>
            ))}
          </div>
        )}

        <NavLink
          to={IMPORT_ITEM.to}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-amber-400/10 text-amber-400 border border-amber-400/15'
                : 'text-ink-300 hover:text-ink-100 hover:bg-white/[0.04]'
            )
          }
        >
          {IMPORT_ITEM.icon}
          {IMPORT_ITEM.label}
        </NavLink>
      </nav>
      </div>

      {/* Demo Mode Banner - fixed above footer */}
      {demoStatus?.has_demo_data && (
        <div className="flex-shrink-0 px-3 pb-3">
          <div className="bg-amber-400/10 border border-amber-400/20 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-400">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
              </svg>
              <span className="text-xs font-medium text-amber-400">Demo Mode</span>
            </div>
            <p className="text-2xs text-ink-300 mb-3">
              {showConfirm
                ? "This will delete all demo accounts and transactions. Are you sure?"
                : "You're viewing sample data. Clear it to add your own accounts."
              }
            </p>
            <div className="flex gap-2">
              {showConfirm && (
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 px-2 py-1.5 text-2xs font-medium text-ink-300 bg-white/5 hover:bg-white/10 rounded transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleEndDemo}
                disabled={clearDemo.isPending}
                className={clsx(
                  "flex-1 px-2 py-1.5 text-2xs font-medium rounded transition-colors",
                  showConfirm
                    ? "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30"
                    : "bg-amber-400/20 text-amber-400 hover:bg-amber-400/30"
                )}
              >
                {clearDemo.isPending ? "Clearing..." : showConfirm ? "Confirm" : "End Demo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer - fixed at bottom */}
      <div ref={settingsRef} className="flex-shrink-0 border-t border-white/[0.06] relative safe-bottom">
        {/* Settings popover */}
        {showSettings && (
          <div className="absolute bottom-full left-0 right-0 mx-3 mb-1">
            <div className="bg-surface-800 border border-white/[0.08] rounded-lg shadow-lg overflow-hidden">
              {!demoStatus?.has_demo_data && !demoStatus?.has_real_data && (
                <button
                  onClick={() => { startDemo.mutate(); setShowSettings(false) }}
                  disabled={startDemo.isPending}
                  className="w-full text-left px-3 py-2.5 text-xs text-ink-200 hover:bg-white/[0.05] transition-colors"
                >
                  {startDemo.isPending ? 'Loading...' : 'Load Demo Data'}
                </button>
              )}
              <div className="border-t border-white/[0.06]">
                <p className="px-3 pt-2 pb-1 text-2xs text-ink-500 font-medium uppercase tracking-wide">Export</p>
                <button
                  onClick={() => { exportApi.transactions(); setShowSettings(false) }}
                  className="w-full text-left px-3 py-2.5 text-xs text-ink-200 hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-ink-400">
                    <path d="M8 2v8M5 7l3 3 3-3M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Transactions CSV
                </button>
                <button
                  onClick={() => { exportApi.balances(); setShowSettings(false) }}
                  className="w-full text-left px-3 py-2.5 text-xs text-ink-200 hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 text-ink-400">
                    <path d="M8 2v8M5 7l3 3 3-3M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Balance History CSV
                </button>
              </div>
              <div className="border-t border-white/[0.06]">
                <p className="px-3 pt-2 pb-1 text-2xs text-ink-500 font-medium uppercase tracking-wide">Account — {currentUser?.username}</p>
                <button
                  onClick={() => { setShowChangePassword(true); setShowSettings(false) }}
                  className="w-full text-left px-3 py-2.5 text-xs text-ink-200 hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-ink-400">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0zm-3 5a1.5 1.5 0 00-.5 2.915V16a.5.5 0 001 0v-1.085A1.5 1.5 0 0010 12z" clipRule="evenodd"/>
                  </svg>
                  Change Password
                </button>
                <button
                  onClick={() => { clearToken(); window.location.reload() }}
                  className="w-full text-left px-3 py-2.5 text-xs text-rose-400 hover:bg-white/[0.05] transition-colors flex items-center gap-2"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                    <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h5a1 1 0 100-2H4V5h4a1 1 0 100-2H3zm11.707 3.293a1 1 0 010 1.414L12.414 10l2.293 2.293a1 1 0 01-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0z" clipRule="evenodd"/>
                  </svg>
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="px-5 py-4 flex items-center justify-between">
          <p className="text-2xs text-ink-300 font-mono">v1.0 · self-hosted</p>
          <button
            onClick={() => setShowSettings(s => !s)}
            className={clsx(
              'p-1.5 rounded-md transition-colors',
              showSettings ? 'text-ink-100 bg-white/[0.08]' : 'text-ink-300 hover:text-ink-100 hover:bg-white/[0.06]'
            )}
            aria-label="Settings"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5" style={{width:'1.375rem',height:'1.375rem'}}>
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>
      </div>
      {showChangePassword && (
        <Modal onClose={() => { setShowChangePassword(false); setPwForm({ current: '', new: '', confirm: '' }); setPwError('') }}>
          <h2 className="text-base font-semibold text-ink-100 mb-4">Change Password</h2>
          <form onSubmit={(e: FormEvent) => {
            e.preventDefault()
            setPwError('')
            if (pwForm.new !== pwForm.confirm) {
              setPwError('New passwords do not match')
              return
            }
            if (pwForm.new.length < 6) {
              setPwError('New password must be at least 6 characters')
              return
            }
            changePassword.mutate(
              { currentPassword: pwForm.current, newPassword: pwForm.new },
              {
                onSuccess: () => {
                  setShowChangePassword(false)
                  setPwForm({ current: '', new: '', confirm: '' })
                  setPwError('')
                },
                onError: (err: Error) => setPwError(err.message),
              }
            )
          }} className="space-y-3">
            <div>
              <label className="block text-xs text-ink-300 mb-1">Current Password</label>
              <input
                type="password"
                value={pwForm.current}
                onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-800 border border-white/[0.08] rounded-lg text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-ink-300 mb-1">New Password</label>
              <input
                type="password"
                value={pwForm.new}
                onChange={e => setPwForm(f => ({ ...f, new: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-800 border border-white/[0.08] rounded-lg text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
                required
                minLength={6}
              />
            </div>
            <div>
              <label className="block text-xs text-ink-300 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={pwForm.confirm}
                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                className="w-full px-3 py-2 bg-surface-800 border border-white/[0.08] rounded-lg text-sm text-ink-100 focus:outline-none focus:border-amber-400/40"
                required
                minLength={6}
              />
            </div>
            {pwError && <p className="text-xs text-rose-400">{pwError}</p>}
            <button
              type="submit"
              disabled={changePassword.isPending}
              className="w-full py-2 bg-amber-400/15 text-amber-400 text-sm font-medium rounded-lg hover:bg-amber-400/25 transition-colors disabled:opacity-50"
            >
              {changePassword.isPending ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </Modal>
      )}
    </aside>
  )
}
