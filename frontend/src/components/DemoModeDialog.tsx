import { useRef, useState } from 'react'
import { useDemoStatus, useClearDemo } from '@/hooks'
import { Button } from '@/components/ui'

/**
 * Soft dialog shown over the app when it loads while demo mode is already
 * active. It only triggers on demo state present at page-load time — if the
 * user turns demo mode on themselves via the gear menu later in the session, we
 * don't nag them about the choice they just made. A reload while still in demo
 * mode brings it back until they actually leave.
 */
export default function DemoModeDialog() {
  const { data: demoStatus } = useDemoStatus()
  const clearDemo = useClearDemo()
  const [dismissed, setDismissed] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)

  // Latch whether demo was active when the status first resolved on load. Only
  // this initial snapshot gates the dialog, so in-session re-entry (gear menu →
  // "Load Demo Data") never pops it up.
  const demoActiveOnLoad = useRef<boolean | null>(null)
  if (demoActiveOnLoad.current === null && demoStatus !== undefined) {
    demoActiveOnLoad.current = demoStatus.has_demo_data
  }

  if (!demoActiveOnLoad.current || !demoStatus?.has_demo_data || dismissed) return null

  const handleLeave = () => {
    // Once cleared, has_demo_data flips false and the dialog unmounts on its own.
    clearDemo.mutate()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="card w-full max-w-md p-6 animate-slide-up">
        {/* Icon */}
        <div className="w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-amber-400">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        <span className="text-2xs font-mono uppercase tracking-widest text-amber-400">Demo Mode Active</span>

        {confirmingLeave ? (
          <>
            <h2 className="text-xl font-semibold text-ink-100 mt-1.5 mb-2">
              Leave demo mode?
            </h2>
            <p className="text-ink-300 text-sm leading-relaxed mb-6">
              This will delete all demo accounts and transactions so you can start fresh
              with your own finances. You can always reload the sample data later from the
              <span className="text-ink-100 font-medium"> settings menu</span> in the sidebar.
            </p>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <Button
                variant="ghost"
                size="md"
                onClick={() => setConfirmingLeave(false)}
                disabled={clearDemo.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={handleLeave}
                loading={clearDemo.isPending}
              >
                Clear demo data
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-ink-100 mt-1.5 mb-2">
              You're viewing sample data
            </h2>
            <p className="text-ink-300 text-sm leading-relaxed mb-6">
              Every account, balance, and transaction shown right now is fictional demo
              data — <span className="text-ink-100 font-medium">none of these values are real</span>.
              It's here so you can explore Forge Finance before adding your own accounts.
            </p>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setConfirmingLeave(true)}
              >
                Leave Demo Mode
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => setDismissed(true)}
              >
                Continue to Demo
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
