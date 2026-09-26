import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginApi, saveToken } from '../services/auth'

const LoginPage = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async () => {
    if (!email || !password) { setError('Please fill in all fields'); return }
    setLoading(true)
    setError('')
    try {
      const data = await loginApi(email, password)
      saveToken(data.access_token)
      navigate('/jobs')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Login failed. Please check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)', width: '360px' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '8px' }}>JobPilot SG</h1>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: '24px' }}>Sign in to your account</p>
        {error && <p style={{ color: 'red', textAlign: 'center', marginBottom: '12px', fontSize: '14px' }}>{error}</p>}
        <input type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={{ width: '100%', padding: '10px', marginBottom: '12px',
            border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }} />
        <input type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={{ width: '100%', padding: '10px', marginBottom: '16px',
            border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }} />
        <button onClick={handleLogin} disabled={loading}
          style={{ width: '100%', padding: '10px', backgroundColor: loading ? '#aaa' : '#1a73e8',
            color: 'white', border: 'none', borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer', fontSize: '16px' }}>
          {loading ? 'Signing in...' : 'Login'}
        </button>
        <p style={{ textAlign: 'center', marginTop: '16px', color: '#666' }}>
          Don't have an account?{' '}
          <span onClick={() => navigate('/register')}
            style={{ color: '#1a73e8', cursor: 'pointer' }}>Sign up</span>
        </p>
      </div>
    </div>
  )
}

export default LoginPage