import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import {
  fetchApplicationAnswers, fetchApplications, updateApplicationStatus,
  type ApplicationRecord, type ApplicationStatus, type SavedApplicationAnswer,
} from '../services/applications'
import { getToken, watchSession } from '../services/auth'

const PAGE_SIZE = 20

const STATUS_CONFIG: Record<ApplicationStatus, { color: string; bg: string; label: string }> = {
  draft: { color: '#6b7280', bg: '#f3f4f6', label: 'Draft' },
  submitted: { color: '#1a73e8', bg: '#e8f0fe', label: 'Reported applied' },
  interviewing: { color: '#9333ea', bg: '#f3e8ff', label: 'Interviewing' },
  offered: { color: '#34a853', bg: '#f0fdf4', label: 'Offered' },
  rejected: { color: '#dc2626', bg: '#fef2f2', label: 'Rejected' },
  withdrawn: { color: '#6b7280', bg: '#f3f4f6', label: 'Withdrawn' },
}

const NEXT_STATUS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['interviewing', 'rejected', 'withdrawn'],
  interviewing: ['offered', 'rejected', 'withdrawn'],
  offered: ['withdrawn'],
  rejected: [],
  withdrawn: [],
}

export default function ApplicationHistoryPage() {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <SessionApplicationHistory key={token ?? 'signed-out'} token={token} />
}

function SessionApplicationHistory({ token }: { token: string | null }) {
  const [applications, setApplications] = useState<ApplicationRecord[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selectedStatus, setSelectedStatus] = useState<Record<string, ApplicationStatus>>({})
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<Record<string, string>>({})
  const [expandedAnswersId, setExpandedAnswersId] = useState<string | null>(null)
  const updates = useRef(new Set<AbortController>())
  const navigate = useNavigate()

  useEffect(() => {
    const request = new AbortController()
    const current = () => !request.signal.aborted && getToken() === token
    const load = async () => {
      setApplications([])
      setError('')
      setLoading(true)
      if (!token) {
        setLoading(false)
        setError('Sign in to JobPilot to view your application records.')
        return
      }
      try {
        const response = await fetchApplications(page, PAGE_SIZE, {
          signal: request.signal, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
        })
        if (!current()) return
        setApplications(response.data.items)
        setPages(response.data.pages)
        setTotal(response.data.total)
      } catch {
        if (current()) setError('Could not load your application records. Check your connection and retry.')
      } finally {
        if (current()) setLoading(false)
      }
    }
    void load()
    return () => request.abort()
  }, [token, page, retry])

  useEffect(() => () => {
    for (const request of updates.current) request.abort()
    updates.current.clear()
  }, [])

  const updateStatus = async (application: ApplicationRecord) => {
    const next = selectedStatus[application.id]
    if (!token || getToken() !== token || updates.current.size > 0 || application.method !== 'manual'
      || !next || !NEXT_STATUS[application.status].includes(next)) return
    if (next === 'submitted' && !window.confirm('Confirm that you personally submitted this application on the original site? JobPilot does not verify employer receipt.')) return
    const request = new AbortController()
    updates.current.add(request)
    setUpdatingId(application.id)
    setUpdateError(previous => ({ ...previous, [application.id]: '' }))
    try {
      const response = await updateApplicationStatus(application.id, next, {
        signal: request.signal, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
      })
      if (request.signal.aborted || getToken() !== token) return
      setApplications(previous => previous.map(item => item.id === application.id ? response.data : item))
      setSelectedStatus(previous => {
        const updated = { ...previous }
        delete updated[application.id]
        return updated
      })
    } catch {
      if (!request.signal.aborted && getToken() === token) {
        setUpdateError(previous => ({ ...previous, [application.id]: 'Could not update this record. Refresh the history and retry.' }))
      }
    } finally {
      updates.current.delete(request)
      if (!request.signal.aborted && getToken() === token) setUpdatingId(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <h2 style={{ marginBottom: '20px' }}>My Applications</h2>
        <p style={{ color: '#555', marginBottom: '20px' }}>These are your JobPilot records and tracked statuses, not verified employer receipts. An assistant record saves reviewed answers; it does not send them to an employer.</p>

        {loading && <p role="status" style={{ textAlign: 'center', color: '#666' }}>Loading application records...</p>}
        {error && <div role="alert" style={{ textAlign: 'center', color: '#dc2626' }}><p>{error}</p>
          {token ? <button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry history</button>
            : <button className="btn btn-primary" onClick={() => navigate('/')}>Sign in</button>}
        </div>}

        {!loading && !error && total === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', backgroundColor: 'white', borderRadius: '8px' }}>
            <p style={{ fontSize: '48px', margin: '0 0 16px 0' }}>📋</p>
            <p style={{ color: '#666' }}>No applications yet.</p>
            <button className="btn btn-primary" onClick={() => navigate('/jobs')}>Browse Jobs</button>
          </div>
        )}

        {!loading && !error && total > 0 && (
          <>
            <p role="status" style={{ color: '#555' }}>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} records</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {applications.map(application => {
                const status = STATUS_CONFIG[application.status]
                const assistant = application.method === 'assistant'
                const manual = application.method === 'manual'
                const label = application.status === 'submitted' && !manual ? 'Record saved' : status.label
                const options = manual ? NEXT_STATUS[application.status] : []
                return (
                  <article key={application.id} aria-label={application.job.title} style={{ backgroundColor: 'white', padding: '20px',
                    borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                    display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ minWidth: 0, flex: '1 1 260px', overflowWrap: 'anywhere' }}>
                      <h3 style={{ margin: '0 0 4px 0' }}>{application.job.title}</h3>
                      <p style={{ margin: '0 0 4px 0', color: '#666' }}>{application.job.company}</p>
                      <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>Recorded: {new Date(application.created_at).toLocaleDateString()}</p>
                      <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#555' }}>{assistant
                        ? 'Assistant record only. JobPilot has not sent these answers to an employer.'
                        : manual ? 'User-reported record. Employer delivery and progress are not verified.'
                          : 'Extension-assisted record. Employer delivery and progress are not verified.'}</p>
                      {options.length > 0 && <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' }}>
                        <label htmlFor={`status-${application.id}`}>Update reported status</label>
                        <select id={`status-${application.id}`} value={selectedStatus[application.id] ?? ''}
                          disabled={Boolean(updatingId)} onChange={event => setSelectedStatus(previous => ({ ...previous, [application.id]: event.target.value as ApplicationStatus }))}>
                          <option value="">Choose status</option>
                          {options.map(option => <option key={option} value={option}>{STATUS_CONFIG[option].label}</option>)}
                        </select>
                        <button className="btn btn-secondary btn-sm" disabled={!selectedStatus[application.id] || Boolean(updatingId)}
                          onClick={() => void updateStatus(application)}>{updatingId === application.id ? 'Saving...' : 'Save status'}</button>
                      </div>}
                      {updateError[application.id] && <div role="alert" style={{ color: '#b91c1c' }}>
                        <p>{updateError[application.id]}</p>
                        <button className="btn btn-secondary btn-sm" onClick={() => {
                          setSelectedStatus({})
                          setUpdateError({})
                          setRetry(value => value + 1)
                        }}>Reload history</button>
                      </div>}
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                      <span style={{ backgroundColor: status.bg, color: status.color, padding: '4px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: '500' }}>{label}</span>
                      {assistant && <button type="button" className="btn btn-secondary btn-sm"
                        aria-expanded={expandedAnswersId === application.id}
                        aria-controls={`saved-answers-${application.id}`}
                        onClick={() => setExpandedAnswersId(current => current === application.id ? null : application.id)}>
                        {expandedAnswersId === application.id ? 'Hide saved answers' : 'View saved answers'}
                      </button>}
                      <button onClick={() => navigate(`/jobs/${application.job.id}`)} style={{ fontSize: '13px', color: '#1a73e8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>View Job →</button>
                    </div>
                    {assistant && token && expandedAnswersId === application.id &&
                      <SavedAnswersPanel applicationId={application.id} token={token} />}
                  </article>
                )
              })}
            </div>
            {pages > 1 && <nav aria-label="Application history pages" style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center', marginTop: '20px' }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(previous => previous - 1)}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(previous => previous + 1)}>Next</button>
            </nav>}
          </>
        )}
      </div>
    </div>
  )
}

function SavedAnswersPanel({ applicationId, token }: { applicationId: string; token: string }) {
  const [answers, setAnswers] = useState<SavedApplicationAnswer[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    fetchApplicationAnswers(applicationId, {
      signal: request.signal, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
    }).then(response => {
      if (!request.signal.aborted && getToken() === token) setAnswers(response.data.answers)
    }).catch(() => {
      if (!request.signal.aborted && getToken() === token) setError('Could not load saved answers. Please retry.')
    }).finally(() => {
      if (!request.signal.aborted && getToken() === token) setLoading(false)
    })
    return () => request.abort()
  }, [applicationId, token, retry])

  return <section id={`saved-answers-${applicationId}`} aria-label="Saved application answers"
    style={{ flexBasis: '100%', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
    <p style={{ margin: '0 0 12px', color: '#555' }}>Saved in JobPilot only. These answers were not sent to the employer.</p>
    {loading && <p role="status">Loading saved answers...</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-secondary btn-sm" onClick={() => {
      setAnswers(null)
      setError('')
      setLoading(true)
      setRetry(value => value + 1)
    }}>Retry</button></div>}
    {!loading && !error && answers?.length === 0 && <p>No confirmed answers were saved for this record.</p>}
    {!loading && !error && answers && answers.length > 0 && <dl style={{ margin: 0 }}>
      {answers.map(answer => <div key={answer.field_id} style={{ marginBottom: '12px' }}>
        <dt style={{ fontWeight: 600 }}>{answer.label}</dt>
        <dd style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{answer.value || '(Left blank)'}</dd>
      </div>)}
    </dl>}
  </section>
}
