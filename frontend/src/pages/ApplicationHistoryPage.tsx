import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchApplications } from '../services/applications'
import { getToken, watchSession } from '../services/auth'

interface Application {
  id: string
  job: { id: string; title: string; company: string }
  submitted_at: string | null
  created_at: string
  status: string
  method?: string
}

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  'draft':        { color: '#6b7280', bg: '#f3f4f6' },
  'submitted':    { color: '#1a73e8', bg: '#e8f0fe' },
  'under_review': { color: '#f59e0b', bg: '#fffbeb' },
  'interview':    { color: '#9333ea', bg: '#f3e8ff' },
  'offered':      { color: '#34a853', bg: '#f0fdf4' },
  'rejected':     { color: '#dc2626', bg: '#fef2f2' },
}

const STATUS_LABEL: Record<string, string> = {
  'draft':        'Draft',
  'submitted':    'Submission recorded',
  'under_review': 'Under Review',
  'interview':    'Interview',
  'offered':      'Offered',
  'rejected':     'Rejected',
}

const ApplicationHistoryPage = () => {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    let pending: AbortController | null = null
    const load = async () => {
      pending?.abort()
      const request = new AbortController()
      pending = request
      const token = getToken()
      const current = () => !request.signal.aborted && getToken() === token
      setApplications([])
      setError('')
      setLoading(true)
      if (!token) {
        setLoading(false)
        setError('Sign in to JobPilot to view your application records.')
        return
      }
      try {
        const res = await fetchApplications(1, 20, {signal: request.signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000})
        if (!current()) return
        setApplications(res.data?.items ?? res.data ?? [])
      } catch {
        if (current()) setError('Could not load your application records. Check your connection and retry.')
      } finally {
        if (current()) setLoading(false)
      }
    }
    void load()
    const unwatch = watchSession(() => { void load() })
    return () => { pending?.abort(); unwatch() }
  }, [retry])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <h2 style={{ marginBottom: '20px' }}>My Applications</h2>
        <p style={{color: '#555', marginBottom: '20px'}}>These are your JobPilot records and tracked statuses, not verified employer receipts. An assistant record saves reviewed answers; it does not send them to an employer.</p>

        {loading && <p role="status" style={{ textAlign: 'center', color: '#666' }}>Loading application records...</p>}
        {error && <div role="alert" style={{ textAlign: 'center', color: '#dc2626' }}><p>{error}</p>
          {getToken() ? <button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry history</button>
            : <button className="btn btn-primary" onClick={() => navigate('/')}>Sign in</button>}
        </div>}

        {!loading && !error && applications.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', backgroundColor: 'white', borderRadius: '8px' }}>
            <p style={{ fontSize: '48px', margin: '0 0 16px 0' }}>📋</p>
            <p style={{ color: '#666' }}>No applications yet.</p>
            <button onClick={() => navigate('/jobs')}
              style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8',
                color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Browse Jobs
            </button>
          </div>
        )}

        {!loading && !error && applications.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {applications.map(app => {
              const status = STATUS_CONFIG[app.status] ?? STATUS_CONFIG['submitted']
              const assistant = app.method === 'assistant'
              const manual = app.method === 'manual'
              const label = app.status === 'submitted' && assistant ? 'Record saved'
                : app.status === 'submitted' && manual ? 'Reported applied'
                  : STATUS_LABEL[app.status] ?? app.status
              return (
                <article key={app.id} aria-label={app.job.title} style={{ backgroundColor: 'white', padding: '20px',
                  borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                  display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{minWidth: 0, flex: '1 1 260px', overflowWrap: 'anywhere'}}>
                    <h3 style={{ margin: '0 0 4px 0' }}>{app.job.title}</h3>
                    <p style={{ margin: '0 0 4px 0', color: '#666' }}>{app.job.company}</p>
                    <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
                      Recorded: {new Date(app.created_at).toLocaleDateString()}
                    </p>
                    <p style={{margin: '8px 0 0', fontSize: '13px', color: '#555'}}>{assistant
                      ? 'Assistant record only. JobPilot has not sent these answers to an employer.'
                      : manual ? 'User-reported record. Employer delivery and progress are not verified.'
                        : 'Employer delivery and progress are not verified by this record.'}</p>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column',
                    alignItems: 'flex-end', gap: '8px' }}>
                    <span style={{ backgroundColor: status.bg, color: status.color,
                      padding: '4px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: '500' }}>
                      {label}
                    </span>
                    <button onClick={() => navigate(`/jobs/${app.job.id}`)}
                      style={{ fontSize: '13px', color: '#1a73e8', background: 'none',
                        border: 'none', cursor: 'pointer', padding: 0 }}>
                      View Job →
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default ApplicationHistoryPage
