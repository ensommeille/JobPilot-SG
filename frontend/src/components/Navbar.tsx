import { useNavigate, useLocation } from 'react-router-dom'
import { removeToken } from '../services/auth'

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

  const handleLogout = () => {
    removeToken()
    navigate('/')
  }

  return (
    <header className="navbar">
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
        <nav className="nav-links">
          {NAV_ITEMS.map(item => (
            <button
              key={item.path}
              className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              {item.icon} <span className="nav-link-label">{item.label}</span>
            </button>
          ))}

          <div className="nav-divider" />

          <button className="user-chip" onClick={() => navigate('/profile')}>
            <span className="avatar">T</span>
            <span className="user-name">Tang Yuchen</span>
          </button>

          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      </div>
    </header>
  )
}

export default Navbar
