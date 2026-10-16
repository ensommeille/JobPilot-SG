import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { createManualApplication, findApplicationForJob, type ApplicationRecord } from '../services/applications'
import { getToken, watchSession } from '../services/auth'

export default function ManualApplicationRecord({ jobId }: { jobId: string }) {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <SessionManualApplicationRecord key={`${jobId}:${token ?? ''}`} jobId={jobId} token={token} />
}

function SessionManualApplicationRecord({ jobId, token }: { jobId: string; token: string | null }) {
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [existing, setExisting] = useState<ApplicationRecord | null>(null)
  const [recorded, setRecorded] = useState(false)
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => { request.current?.abort() }, [])

  const saveRecord = async () => {
    if (!token || getToken() !== token || !confirmed || request.current) return
    const controller = new AbortController()
    request.current = controller
    const current = () => !controller.signal.aborted && getToken() === token
    const config = { signal: controller.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } }
    setPending(true)
    setError('')
    try {
      await createManualApplication(jobId, config)
      if (current()) { setRecorded(true); setOpen(false) }
    } catch (cause) {
      if (!current()) return
      if (axios.isAxiosError(cause) && cause.response?.status === 409) {
        try {
          const found = await findApplicationForJob(jobId, config)
          if (current() && found) setExisting(found)
          else if (current()) setError('This job already has a record, but it could not be located. Open My Applications and retry.')
        } catch {
          if (current()) setError('This job already has a record. Open My Applications to view it.')
        }
      } else {
        setError('Could not save your report. Check your connection and retry.')
      }
    } finally {
      if (request.current === controller) request.current = null
      if (current()) setPending(false)
    }
  }

  if (recorded) return <p role="status">Your reported application was saved in <Link to="/applications">My Applications</Link>. Employer receipt is not verified.</p>
  if (existing) return <p role="status">A record already exists for this job: {existing.method === 'manual' ? `user-tracked status: ${existing.status}` : 'assisted record saved, not a verified employer submission'}. <Link to="/applications">View My Applications</Link>.</p>

  return <div style={{ marginTop: '18px' }}>
    {!open ? <button type="button" className="btn btn-secondary" style={{ maxWidth: '100%', height: 'auto', minHeight: '40px', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setOpen(true)}>Record an application I made on the original site</button> : <div style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '16px' }}>
      <p style={{ marginTop: 0 }}>Only use this after you personally submitted on the original site. JobPilot will save your report; it cannot verify employer receipt.</p>
      {!token ? <p><Link to="/">Sign in</Link> to save a record.</p> : <>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />
          I personally submitted this application on the original site.
        </label>
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button type="button" className="btn btn-primary" disabled={!confirmed || pending} onClick={() => void saveRecord()}>{pending ? 'Saving...' : 'Save my report'}</button>
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => { setOpen(false); setConfirmed(false); setError('') }}>Cancel</button>
        </div>
      </>}
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error} <Link to="/applications">My Applications</Link></p>}
    </div>}
  </div>
}
