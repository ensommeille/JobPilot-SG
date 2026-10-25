import { useState, useEffect, useId, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getToken, logoutPlatform, watchSession } from '../services/auth'
import api from '../services/api'
import HowToUseGuide from './HowToUseGuide'
import './Navbar.css'

interface NavbarProps {
  backTo?: string
  backLabel?: string
}

const NAV_ITEMS = [
  { label: 'Jobs', icon: '⌕', path: '/jobs' },
  { label: 'Favorites', icon: '☆', path: '/favorites' },
  { label: 'Applications', icon: '▤', path: '/applications' },
]

const Navbar = ({ backTo, backLabel = '← Back' }: NavbarProps) => {
  const navigate = useNavigate()
  const location = useLocation()
  const [userName, setUserName] = useState('')
  const [adminToken, setAdminToken] = useState<string | null>(null)
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const guideId = useId()
  const guideButton = useRef<HTMLButtonElement>(null)
  const showGuide = location.pathname === '/jobs'

  const closeGuide = () => {
    setGuideOpen(false)
    guideButton.current?.focus()
  }

  useEffect(() => {
    let pending: AbortController | null = null
    const load = () => {
      pending?.abort()
      setUserName('')
      setAdminToken(null)
      const token = getToken()
      if (!token) return
      const request = new AbortController()
      pending = request
      api.get('/profile', {signal: request.signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000})
        .then(res => { if (!request.signal.aborted && getToken() === token) setUserName(res.data.full_name ?? res.data.contact_email ?? 'Account') })
        .catch(() => { if (!request.signal.aborted && getToken() === token) setUserName('Account') })
      api.get<{role: string}>('/users/me', {signal: request.signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000})
        .then(res => { if (!request.signal.aborted && getToken() === token && res.data.role === 'admin') setAdminToken(token) })
        .catch(() => { /* Keep the admin entry hidden when role verification fails. */ })
    }
    load()
    const unwatch = watchSession(load)
    return () => { pending?.abort(); unwatch() }
  }, [])

  const handleLogout = async () => {
    setLoggingOut(true); setLogoutError('')
    try { await logoutPlatform(); if (!getToken()) navigate('/') }
    catch (error) { setLogoutError(error instanceof Error ? error.message : 'Logout failed. Please retry.') }
    finally { setLoggingOut(false) }
  }

  return (
    <>
    <header className={`navbar${showGuide ? ' navbar-with-guide' : ''}`}>
      <div className="navbar-inner">
        {/* 左侧：Logo + 可选返回按钮 */}
        <div className="row" style={{ gap: 'var(--s-4)' }}>
          <button className="brand" onClick={() => navigate('/jobs')}>
            <span className="brand-mark">JP</span>
            JobPilot SG
          </button>
          {backTo && (
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(backTo)}>
              {backLabel}
            </button>
          )}
        </div>

        {/* 右侧：导航 + 用户 + Logout */}
        <nav className="nav-links" aria-label="Main navigation">
          {NAV_ITEMS.map(item => (
            <button
              key={item.path}
              aria-label={item.label}
              className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              {item.icon} <span className="nav-link-label">{item.label}</span>
            </button>
          ))}

          {adminToken && adminToken === getToken() && <button
            aria-label="Admin"
            className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
            onClick={() => navigate('/admin')}
          >Admin</button>}

          {showGuide && <button
            ref={guideButton}
            type="button"
            className="btn btn-ghost navbar-guide-button"
            aria-expanded={guideOpen}
            aria-controls={guideId}
            onClick={() => setGuideOpen(open => !open)}
            onKeyDown={event => { if (event.key === 'Escape' && guideOpen) { event.preventDefault(); closeGuide() } }}
          >How to use</button>}

          <div className="nav-divider" />

          <button className="user-chip" aria-label={userName ? `Your profile: ${userName}` : 'Your profile'} onClick={() => navigate('/profile')}>
            <span className="avatar">{userName.charAt(0) || '?'}</span>
            <span className="user-name">{userName || 'Account'}</span>
          </button>

          <button className="btn btn-ghost btn-sm" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'Signing out…' : 'Logout'}
          </button>
        </nav>
      </div>
      {logoutError && <p role="alert" className="alert alert-error">{logoutError}</p>}
    </header>
    {showGuide && guideOpen && <HowToUseGuide id={guideId} onClose={closeGuide} />}
    </>
  )
}

export default Navbar
