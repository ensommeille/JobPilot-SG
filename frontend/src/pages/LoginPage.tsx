import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveToken } from '../services/auth'

const LoginPage = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleLogin = () => {
    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }
    // 后端未就绪时用假 Token，对接后替换为真实 API 调用
    saveToken('fake-jwt-token-for-dev')
    navigate('/jobs')
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white', padding: '40px',
        borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        width: '360px'
      }}>
        <h1 style={{ textAlign: 'center', marginBottom: '8px' }}>JobPilot SG</h1>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: '24px' }}>
          Sign in to your account
        </p>
        {error && (
          <p style={{ color: 'red', textAlign: 'center', marginBottom: '12px' }}>
            {error}
          </p>
        )}
        <input
          type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: '100%', padding: '10px', marginBottom: '12px',
            border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }}
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', padding: '10px', marginBottom: '16px',
            border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }}
        />
        <button onClick={handleLogin}
          style={{ width: '100%', padding: '10px', backgroundColor: '#1a73e8',
            color: 'white', border: 'none', borderRadius: '4px',
            cursor: 'pointer', fontSize: '16px' }}>
          Login
        </button>
        <p style={{ textAlign: 'center', marginTop: '16px', color: '#666' }}>
          Don't have an account?{' '}
          <span onClick={() => navigate('/register')}
            style={{ color: '#1a73e8', cursor: 'pointer' }}>
            Sign up
          </span>
        </p>
      </div>
    </div>
  )
}

export default LoginPage