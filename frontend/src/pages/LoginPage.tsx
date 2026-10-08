import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
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
    <AuthLayout>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); handleLogin() }}>
        <div>
          <h1>Welcome back</h1>
          <p className="muted" style={{ marginTop: 'var(--s-1)' }}>Sign in to continue your job search.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" placeholder="you@example.com" value={email}
            onChange={e => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input className="input" type="password" placeholder="Enter your password" value={password}
            onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </label>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-footer">
          Don't have an account?{' '}
          <button type="button" className="link" onClick={() => navigate('/register')}>Sign up</button>
        </p>
      </form>
    </AuthLayout>
  )
}

export default LoginPage