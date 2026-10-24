import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchApplicationAnswers, updateApplicationStatus, type ApplicationStatus, type SavedApplicationAnswer } from '../services/applications'
import { fetchApplicationHistory, type HistoryChannel, type UnifiedApplicationRecord } from '../services/applicationJourney'
import { getToken, watchSession } from '../services/auth'
import './ApplicationHistoryPage.css'

const PAGE_SIZE = 20
const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft', submitted: 'Reported applied', interviewing: 'Interviewing',
  offered: 'Offered', rejected: 'Rejected', withdrawn: 'Withdrawn',
}
const NEXT_STATUS: Record<ApplicationStatus, ApplicationStatus[]> = {
  draft: ['submitted', 'withdrawn'], submitted: ['interviewing', 'rejected', 'withdrawn'],
  interviewing: ['offered', 'rejected', 'withdrawn'], offered: ['withdrawn'], rejected: [], withdrawn: [],
}
const CHANNEL_LABELS: Record<HistoryChannel, string> = {
  email: 'Email test pilot', manual: 'Manually tracked', assistant: 'Assistant record', extension: 'Extension record',
}

export default function ApplicationHistoryPage() {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <SessionApplicationHistory key={token ?? 'signed-out'} token={token} />
}

function SessionApplicationHistory({ token }: { token: string | null }) {
  const [applications, setApplications] = useState<UnifiedApplicationRecord[]>([])
  const [page, setPage] = useState(1)
  const [channel, setChannel] = useState<HistoryChannel | ''>('')
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
      if (!token) { setLoading(false); setError('Sign in to JobPilot to view your application records.'); return }
      try {
        const response = await fetchApplicationHistory(page, PAGE_SIZE, channel, {
          signal: request.signal, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
        })
        if (!current()) return
        setApplications(response.data.items)
        setPages(response.data.pages)
        setTotal(response.data.total)
      } catch {
        if (current()) setError('Could not load your applications. Check your connection and retry.')
      } finally { if (current()) setLoading(false) }
    }
    void load()
    return () => request.abort()
  }, [token, page, channel, retry])

  useEffect(() => () => {
    for (const request of updates.current) request.abort()
    updates.current.clear()
  }, [])

  const updateStatus = async (application: UnifiedApplicationRecord) => {
    const next = selectedStatus[application.id]
    const allowed = NEXT_STATUS[application.status as ApplicationStatus] ?? []
    if (!token || getToken() !== token || updates.current.size > 0 || application.kind !== 'application'
      || application.method !== 'manual' || !next || !allowed.includes(next)) return
    if (next === 'submitted' && !window.confirm('Confirm that you personally submitted this application on the original site? JobPilot does not verify employer receipt.')) return
    const request = new AbortController()
    updates.current.add(request)
    setUpdatingId(application.id)
    setUpdateError(previous => ({ ...previous, [application.id]: '' }))
    try {
      await updateApplicationStatus(application.record_id, next, {
        signal: request.signal, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
      })
      if (request.signal.aborted || getToken() !== token) return
      setSelectedStatus(previous => {
        const nextSelection = { ...previous }
        delete nextSelection[application.id]
        return nextSelection
      })
      setRetry(value => value + 1)
    } catch {
      if (!request.signal.aborted && getToken() === token) setUpdateError(previous => ({ ...previous, [application.id]: 'The status could not be saved. Reload the record before trying again.' }))
    } finally {
      updates.current.delete(request)
      if (!request.signal.aborted && getToken() === token) setUpdatingId(null)
    }
  }

  return <div className="page application-history-page">
    <Navbar />
    <main className="container application-history-container">
      <header className="page-header"><h1>My Applications</h1><p>Preparation drafts, saved answers and email records in one place. These records do not verify employer receipt; the email pilot sends only to a local test inbox.</p></header>
      <div className="application-history-toolbar">
        <label className="field" htmlFor="application-history-channel"><span className="label">Application type</span>
          <select id="application-history-channel" className="select" value={channel} onChange={event => {
            setChannel(event.target.value as HistoryChannel | '')
            setPage(1)
            setSelectedStatus({})
            setExpandedAnswersId(null)
            setUpdateError({})
          }}>
            <option value="">All application types</option>
            {Object.entries(CHANNEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <Link className="btn btn-secondary" to="/jobs">Browse jobs</Link>
      </div>
      {loading && <p role="status" className="muted">Loading your applications…</p>}
      {error && <div role="alert" className="alert alert-error"><p>{error}</p>{token
        ? <button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry history</button>
        : <button className="btn btn-primary" onClick={() => navigate('/')}>Sign in</button>}</div>}
      {!loading && !error && total === 0 && <div className="application-history-empty"><h2>{channel ? 'No records of this type yet' : 'Start with a job you want to apply for'}</h2><p>Choose Prepare application on a job to review your details and PDF. Saved preparation and email drafts will appear here.</p>{channel && <button className="btn btn-secondary" onClick={() => { setChannel(''); setPage(1) }}>Show all application types</button>}</div>}
      {!loading && !error && total > 0 && <>
        <p role="status" className="application-history-count">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} records</p>
        <div className="application-history-list">
          {applications.map(application => {
            const assistant = application.kind === 'application' && application.method === 'assistant'
            const manual = application.kind === 'application' && application.method === 'manual'
            const options = manual ? NEXT_STATUS[application.status as ApplicationStatus] ?? [] : []
            return <article key={application.id} className="application-history-row" aria-label={application.job.title}>
              <div className="application-history-record">
                <div className="application-history-record-heading"><h2>{application.job.title}</h2><span className="application-status" data-state={application.status}>{application.display_status}</span></div>
                <p className="muted">{application.job.company} · {CHANNEL_LABELS[application.channel]}</p>
                <p className="application-record-date">Updated {new Date(application.updated_at).toLocaleString()}</p>
                <p>{application.next_action}</p>
                {application.resume_filename && <p className="muted">PDF: {application.resume_filename}</p>}
                {application.kind === 'email' && <>
                  <p className="muted">Actual test recipient: {application.actual_recipient || 'Not configured'}</p>
                  {application.sent_at && <p className="application-record-date">Test SMTP acceptance: {new Date(application.sent_at).toLocaleString()}</p>}
                  {application.receipt?.message_id && <details><summary>Test delivery reference</summary><p className="application-message-reference">{application.receipt.message_id}</p><p className="muted">This confirms local test SMTP acceptance, not employer receipt.</p></details>}
                  {application.failure_code && <p className="application-history-error">{application.failure_code}</p>}
                </>}
                {options.length > 0 && <div className="application-status-controls">
                  <label htmlFor={`status-${application.id}`}>Update reported status</label>
                  <select id={`status-${application.id}`} className="select" value={selectedStatus[application.id] ?? ''} disabled={Boolean(updatingId)} onChange={event => setSelectedStatus(previous => ({ ...previous, [application.id]: event.target.value as ApplicationStatus }))}>
                    <option value="">Choose status</option>{options.map(option => <option key={option} value={option}>{STATUS_LABELS[option]}</option>)}
                  </select>
                  <button className="btn btn-secondary btn-sm" disabled={!selectedStatus[application.id] || Boolean(updatingId)} onClick={() => void updateStatus(application)}>{updatingId === application.id ? 'Saving…' : 'Save status'}</button>
                </div>}
                {updateError[application.id] && <div role="alert" className="application-history-error"><p>{updateError[application.id]}</p><button className="btn btn-secondary btn-sm" onClick={() => { setSelectedStatus({}); setUpdateError({}); setRetry(value => value + 1) }}>Reload history</button></div>}
                <div className="application-history-links">
                  <Link className="btn btn-secondary btn-sm" to={`/jobs/${application.job.id}/prepare`}>{application.kind === 'email' && application.status === 'draft' ? 'Continue email draft' : 'Open preparation'}</Link>
                  <Link className="link" to={`/jobs/${application.job.id}`}>View job</Link>
                  {assistant && <button className="link" aria-expanded={expandedAnswersId === application.id} aria-controls={`saved-answers-${application.record_id}`} onClick={() => setExpandedAnswersId(current => current === application.id ? null : application.id)}>{expandedAnswersId === application.id ? 'Hide saved answers' : 'View saved answers'}</button>}
                </div>
                {assistant && token && expandedAnswersId === application.id && <SavedAnswersPanel applicationId={application.record_id} token={token} />}
              </div>
            </article>
          })}
        </div>
        {pages > 1 && <nav aria-label="Application history pages" className="application-history-pagination"><button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(previous => previous - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(previous => previous + 1)}>Next</button></nav>}
      </>}
    </main>
  </div>
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
