import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { getToken, watchSession } from '../services/auth'
import { emailError, emailStatus } from '../services/emailApplications'
import type { EmailDraft } from '../services/emailApplications'
import { sourceTime } from '../services/sourceStatus'
import './EmailApplication.css'

export default function EmailApplicationHistory() {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return token ? <History key={token} token={token} /> : null
}

function History({ token }: { token: string }) {
  const [items, setItems] = useState<EmailDraft[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const request = new AbortController()
    api.get('/email-applications', { signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } })
      .then(response => { if (!request.signal.aborted && getToken() === token) setItems(response.data.items) })
      .catch(error => { if (!request.signal.aborted && getToken() === token) setError(emailError(error)) })
      .finally(() => { if (!request.signal.aborted && getToken() === token) setLoading(false) })
    return () => request.abort()
  }, [token, retry])
  return <section className="email-application" aria-label="Email application history">
    <h3>Email application pilot</h3>
    <p>Drafts and test email deliveries are tracked separately from your other application records.</p>
    {loading ? <p role="status">Loading your email records…</p> : error ? <div role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={() => { setLoading(true); setError(''); setRetry(value => value + 1) }}>Retry email history</button></div>
      : items.length === 0 ? <p className="muted">No email drafts or test deliveries yet.</p>
        : <ul className="email-history">{items.map(item => <li key={item.id}><Link to={`/jobs/${item.job_id}`}>{item.job_title || item.subject}</Link><p>{emailStatus(item.status)} · {item.actual_recipient || 'No test recipient configured'}</p><p className="muted">{item.attachment?.filename || 'No PDF attached'}{item.sent_at && ` · ${sourceTime(item.sent_at)}`}</p></li>)}</ul>}
  </section>
}
