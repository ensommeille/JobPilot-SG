import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import { registerApi } from '../services/auth'

const RegisterPage = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword) { setError('Please fill in all fields'); return }
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError('')
    try {
      await registerApi(email, password)
      navigate('/')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : 'Registration failed. Email may already be in use.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <form className="auth-form" onSubmit={e => { e.preventDefault(); handleRegister() }}>
        <div>
          <h1>Create your account</h1>
          <p className="muted" style={{ marginTop: 'var(--s-1)' }}>Build one profile, reuse it for every application.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <label className="field">
          <span className="label">Email</span>
          <input className="input" type="email" placeholder="you@example.com" value={email}
            onChange={e => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input className="input" type="password" placeholder="At least 8 characters" value={password}
            onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="field">
          <span className="label">Confirm password</span>
          <input className="input" type="password" placeholder="Re-enter your password" value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </label>

        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>

        <p className="auth-footer">
          Already have an account?{' '}
          <button type="button" className="link" onClick={() => navigate('/')}>Sign in</button>
        </p>
      </form>
    </AuthLayout>
  )
}

export default RegisterPage