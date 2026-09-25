import { useNavigate, useLocation } from 'react-router-dom'
import { removeToken } from '../services/auth'

interface NavbarProps {
  backTo?: string
  backLabel?: string
}

const Navbar = ({ backTo, backLabel = '← Back' }: NavbarProps) => {
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    removeToken()
    navigate('/')
  }

  const navBtn = (label: string, path: string) => (
    <button
      onClick={() => navigate(path)}
      style={{
        backgroundColor: 'transparent',
        color: 'white',
        border: location.pathname === path ? '1px solid white' : '1px solid rgba(255,255,255,0.4)',
        borderRadius: '4px',
        padding: '6px 14px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: location.pathname === path ? '600' : '400'
      }}>
      {label}
    </button>
  )

  return (
    <div style={{
      backgroundColor: '#1a73e8', padding: '0 32px', height: '56px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      position: 'sticky', top: 0, zIndex: 100
    }}>
      {/* 左侧：Logo + 可选返回按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h1 onClick={() => navigate('/jobs')}
          style={{ color: 'white', margin: 0, fontSize: '20px', cursor: 'pointer' }}>
          JobPilot SG
        </h1>
        {backTo && (
          <button onClick={() => navigate(backTo)}
            style={{ backgroundColor: 'transparent', color: 'white',
              border: '1px solid rgba(255,255,255,0.6)', borderRadius: '4px',
              padding: '4px 12px', cursor: 'pointer', fontSize: '13px' }}>
            {backLabel}
          </button>
        )}
      </div>

      {/* 右侧：导航链接 + 用户 + Logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {navBtn('☆ Favorites', '/favorites')}
        {navBtn('📋 Applications', '/applications')}

        <div style={{ width: '1px', height: '24px', backgroundColor: 'rgba(255,255,255,0.3)', margin: '0 4px' }} />

        <div onClick={() => navigate('/profile')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '50%',
            backgroundColor: 'white', color: '#1a73e8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 'bold', fontSize: '13px'
          }}>T</div>
          <span style={{ color: 'white', fontSize: '13px' }}>Tang Yuchen</span>
        </div>

        <button onClick={handleLogout}
          style={{ backgroundColor: 'transparent', color: 'white',
            border: '1px solid rgba(255,255,255,0.6)', borderRadius: '4px',
            padding: '6px 14px', cursor: 'pointer', fontSize: '13px' }}>
          Logout
        </button>
      </div>
    </div>
  )
}

export default Navbar