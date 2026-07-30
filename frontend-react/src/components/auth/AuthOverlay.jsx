import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { useQueryClient } from '@tanstack/react-query'

export default function AuthOverlay() {
  const { setAuthenticated, setUsername } = useStore()
  const qc = useQueryClient()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [username, setUsernameInput] = useState('')
  const [password, setPasswordInput] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const url = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Authentication failed')
      }
      const data = await res.json()
      setUsername(data.username)
      setAuthenticated(true)
      qc.invalidateQueries({ queryKey: ['projects'] })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-overlay">
      <div className="auth-ambient-glow" />
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo-badge">
            <svg className="logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 6V12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="logo-text">PatentLens <span className="logo-badge">Studio</span></span>
        </div>

        <div className="auth-tabs" role="tablist">
          <button type="button" className={`auth-tab ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError('') }}>Sign In</button>
          <button type="button" className={`auth-tab ${mode === 'register' ? 'active' : ''}`} onClick={() => { setMode('register'); setError('') }}>Create Account</button>
        </div>

        <h2>{mode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
        <p>{mode === 'login' ? 'Please enter your details to sign in' : 'Join PatentLens Studio to manage your projects'}</p>

        <form className="auth-form" onSubmit={handleSubmit} autoComplete="on">
          <div className="input-group">
            <label htmlFor="auth-username">Username</label>
            <div className="input-with-icon">
              <svg className="input-leading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
              <input type="text" id="auth-username" required placeholder="Enter username (case-sensitive)" autoComplete="username" spellCheck="false" value={username} onChange={e => setUsernameInput(e.target.value)} />
            </div>
          </div>
          <div className="input-group">
            <label htmlFor="auth-password">Password</label>
            <div className="input-with-icon">
              <svg className="input-leading-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <input type={showPassword ? 'text' : 'password'} id="auth-password" required placeholder="Enter your password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPasswordInput(e.target.value)} />
              <button type="button" className="input-trailing-btn" onClick={() => setShowPassword(!showPassword)} title="Toggle Password Visibility" aria-label="Toggle Password Visibility">
                {showPassword
                  ? <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>
          {error && <div className="auth-error-msg">{error}</div>}
          <button type="submit" className="btn-primary auth-submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-toggle-row">
          <span>{mode === 'login' ? "Don't have an account?" : 'Already have an account?'}</span>
          <button type="button" className="btn-link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>
            {mode === 'login' ? 'Create an account' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  )
}
