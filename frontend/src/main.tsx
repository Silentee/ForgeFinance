import React, { useState, useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'

import { getToken, setAuthFailureHandler } from '@/lib/api'
import { authApi } from '@/lib/services'
import RootLayout from '@/components/layout/RootLayout'
import Dashboard    from '@/pages/Dashboard'
import AccountsPage from '@/pages/Accounts'
import TransactionsPage from '@/pages/Transactions'
import BudgetPage   from '@/pages/Budget'
import ReportsPage  from '@/pages/Reports'
import ImportPage   from '@/pages/Import'
import LoginPage    from '@/pages/Login'

import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,       // 1 minute
      retry: 1,
      refetchOnWindowFocus: false, // avoids unexpected refetches on a local app
    },
  },
})

type AuthState = 'checking' | 'authenticated' | 'unauthenticated'

function AuthGate() {
  const [authState, setAuthState] = useState<AuthState>(
    getToken() ? 'checking' : 'unauthenticated'
  )

  // Validate token on mount (once)
  useEffect(() => {
    if (authState !== 'checking') return
    authApi.me()
      .then(() => setAuthState('authenticated'))
      .catch(() => setAuthState('unauthenticated'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Register 401 handler so interceptor can revoke auth without page reload
  useEffect(() => {
    setAuthFailureHandler(() => setAuthState('unauthenticated'))
  }, [])

  const handleAuthSuccess = useCallback(() => {
    setAuthState('authenticated')
    queryClient.invalidateQueries()
  }, [])

  if (authState === 'checking') {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return <LoginPage onSuccess={handleAuthSuccess} />
  }

  return (
    <Routes>
      <Route element={<RootLayout />}>
        <Route index        element={<Dashboard />} />
        <Route path="accounts"     element={<AccountsPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="budget"       element={<BudgetPage />} />
        <Route path="reports/:reportTab" element={<ReportsPage />} />
        <Route path="import"       element={<ImportPage />} />
      </Route>
    </Routes>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>

      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#161b24',
            color: '#f0ede8',
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'Sora, sans-serif',
            fontSize: '13px',
            borderRadius: '10px',
          },
          success: { iconTheme: { primary: '#34d4b1', secondary: '#161b24' } },
          error:   { iconTheme: { primary: '#f87171', secondary: '#161b24' } },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>
)
