// API client with 401 interceptor — port of original window.fetch override
import { useStore } from '../store/useStore'

export async function apiClient(url, options = {}) {
  const response = await fetch(url, options)
  if (response.status === 401 && !url.includes('/api/auth/')) {
    // Trigger auth overlay via store
    useStore.getState().handleUnauthorized()
    throw new Error('Unauthorized')
  }
  return response
}

export async function apiFetch(url, options = {}) {
  const res = await apiClient(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  return res
}

export async function apiJson(url, options = {}) {
  const res = await apiFetch(url, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }))
    throw new Error(err.detail || 'Request failed')
  }
  return res.json()
}
