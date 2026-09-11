import { useNavigate } from 'react-router-dom'
import { removeToken } from '../services/auth'

interface NavbarProps {
  backTo?: string
  backLabel?: string
}

const Navbar = ({ backTo, backLabel = '← Back' }: NavbarProps) => {
  const navigate = useNavigate()

  const handleLogout = () => {
    removeToken()
    navigate('/')
  }

  return (
    <div style={{
      backgroundColor: '#1a73e8', padding: '0 32px', height: '56px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      position: 'sticky', top: 0, zIndex: 100
    }}>
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* 假用户头像 + 名字，等后端接好后替换 */}
        <div onClick={() => navigate('/profile')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            backgroundColor: 'white', color: '#1a73e8',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 'bold', fontSize: '14px'
          }}>T</div>
          <span style={{ color: 'white', fontSize: '14px' }}>Tang Yuchen</span>
        </div>
        <button onClick={handleLogout}
          style={{ backgroundColor: 'transparent', color: 'white',
            border: '1px solid rgba(255,255,255,0.6)', borderRadius: '4px',
            padding: '6px 16px', cursor: 'pointer', fontSize: '14px' }}>
          Logout
        </button>
      </div>
    </div>
  )
}

export default Navbar