import { useState } from 'react'
import { useAuthStatus, useLogin, useSetup } from '@/hooks'
import { Spinner } from '@/components/ui'

interface LoginPageProps {
  onSuccess: () => void
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const { data: authStatus, isLoading: statusLoading } = useAuthStatus()
  const login = useLogin()
  const setup = useSetup()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const isSetup = authStatus?.setup_required ?? false
  const isSubmitting = login.isPending || setup.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (isSetup) {
      if (password !== confirmPassword) return
      setup.mutate({ username, password }, { onSuccess })
    } else {
      login.mutate({ username, password }, { onSuccess })
    }
  }

  if (statusLoading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-ink-100 font-heading">Forge Finance</h1>
          <p className="text-sm text-ink-400 mt-2">
            {isSetup ? 'Create your admin account to get started' : 'Sign in to continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface-800 border border-white/[0.08] rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-300 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-ink-100 placeholder-ink-500 focus:outline-none focus:border-amber-400/40"
              placeholder="Username"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-300 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-ink-100 placeholder-ink-500 focus:outline-none focus:border-amber-400/40"
              placeholder={isSetup ? 'Choose a password (min 6 chars)' : 'Password'}
            />
          </div>

          {isSetup && (
            <div>
              <label className="block text-xs font-medium text-ink-300 mb-1.5">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="w-full bg-surface-700 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-ink-100 placeholder-ink-500 focus:outline-none focus:border-amber-400/40"
                placeholder="Confirm your password"
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-rose-400 mt-1">Passwords do not match</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || (isSetup && password !== confirmPassword)}
            className="w-full bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-surface-900 font-semibold text-sm py-2.5 rounded-lg transition-colors"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner /> {isSetup ? 'Creating Account...' : 'Signing In...'}
              </span>
            ) : (
              isSetup ? 'Create Account' : 'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
