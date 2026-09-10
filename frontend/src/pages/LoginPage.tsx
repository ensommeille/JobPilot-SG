import { useState } from 'react'

const LoginPage = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleLogin = () => {
    alert(`Logging in with: ${email}`)
    // 后端 API 对接后这里会替换成真实的登录逻辑
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
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: '100%', padding: '10px', marginBottom: '12px',
            border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', padding: '10px', marginBottom: '16px',
            border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }}
        />
        <button
          onClick={handleLogin}
          style={{ width: '100%', padding: '10px', backgroundColor: '#1a73e8',
            color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer',
            fontSize: '16px' }}
        >
          Login
        </button>
      </div>
    </div>
  )
}

export default LoginPage