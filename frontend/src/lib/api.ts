import axios from 'axios'

// Base URL is either the Vite proxy (dev) or set via env var (Pi deployment)
// During dev the Vite proxy forwards /api → http://localhost:8000/api
// For Pi deployment set VITE_API_BASE_URL=http://192.168.1.42:8000 in .env.local
const BASE_URL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api/v1`
  : '/api/v1'

const TOKEN_KEY = 'forge_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
})

// Request interceptor — attach Bearer token if available
apiClient.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auth failure callback — set by AuthGate to handle 401s without full page reload
let onAuthFailure: (() => void) | null = null
export function setAuthFailureHandler(handler: () => void) {
  onAuthFailure = handler
}

// Response interceptor — surface error messages clearly, handle 401
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    // On 401 from any non-auth endpoint, clear token and notify AuthGate
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/')) {
      clearToken()
      onAuthFailure?.()
    }
    const detail = err.response?.data?.detail
    const message = Array.isArray(detail)
      ? detail.map((e: { msg: string }) => e.msg).join(', ')
      : detail || err.response?.data?.message || err.message || 'An unexpected error occurred'
    return Promise.reject(new Error(message))
  }
)
