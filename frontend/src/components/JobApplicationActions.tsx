import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { internsgApplicationUrl } from '../services/internsg'
import ManualApplicationRecord from './ManualApplicationRecord'

interface ApplicationJob {
  id: string
  status?: string
  apply_url?: string | null
  source_url?: string | null
  assistant_form_available?: boolean
}

function publicUrl(value?: string | null): string | null {
  try {
    const url = new URL(value ?? '')
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

export default function JobApplicationActions({ job }: { job: ApplicationJob }) {
  const context = JSON.stringify([job.id, job.status, job.assistant_form_available, Boolean(internsgApplicationUrl(job.apply_url))])
  return <ApplicationOptions key={context} job={job} />
}

function ApplicationOptions({ job }: { job: ApplicationJob }) {
  const embedded = internsgApplicationUrl(job.apply_url)
  const [legacyFormState, setLegacyFormState] = useState<'loading' | 'configured' | 'none' | 'failed'>('loading')
  const [retry, setRetry] = useState(0)
  const active = job.status === 'active'
  const availability = job.assistant_form_available
  const hasAvailability = typeof availability === 'boolean'
  const formState = hasAvailability ? (availability ? 'configured' : 'none') : legacyFormState
  useEffect(() => {
    if (embedded || !active || hasAvailability) return
    const request = new AbortController()
    api.get('/assistant/bootstrap', {signal: request.signal, timeout: 15000})
      .then(response => {
        if (request.signal.aborted) return
        const forms: unknown = response.data?.forms
        if (!Array.isArray(forms)) throw new Error('Invalid form configuration')
        setLegacyFormState(forms.some(form => String(form?.job_id) === String(job.id)) ? 'configured' : 'none')
      })
      .catch(() => { if (!request.signal.aborted) setLegacyFormState('failed') })
    return () => request.abort()
  }, [job.id, embedded, active, hasAvailability, retry])
  const original = publicUrl(job.source_url)
  const external = publicUrl(job.apply_url)
  return <section aria-label="Application options">
    {!active ? <p role="status">This job is not active. Check the original listing before applying.</p>
      : embedded ? <p>Prepare and confirm your saved details in JobPilot, then fill the original InternSG form. Complete CAPTCHA and final submission yourself.</p>
        : formState === 'configured' ? <p>Review and save an application record in JobPilot. This does not send it to an external employer.</p>
          : formState === 'loading' ? <p role="status">Checking available application options…</p>
            : formState === 'failed' ? <p role="alert">Could not check the JobPilot form. <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setLegacyFormState('loading'); setRetry(value => value + 1) }}>Retry form check</button></p>
              : <p>No in-platform application form is configured for this job. Follow the original listing's application instructions.</p>}
    <div className="row" style={{gap: 12, flexWrap: 'wrap'}}>
      {active && embedded && <Link className="btn btn-primary" to={`/jobs/${job.id}/apply-external`}>Prepare application</Link>}
      {active && !embedded && formState === 'configured' && <Link className="btn btn-primary" to={`/jobs/${job.id}/apply`}>Apply with AI Assistant</Link>}
      {active && !embedded && external && external !== original && <a className="btn btn-secondary" href={external} target="_blank" rel="noopener noreferrer">Open original application ↗</a>}
      {original && <a className="btn btn-secondary" href={original} target="_blank" rel="noopener noreferrer">View Original Posting ↗</a>}
    </div>
    {active && <ManualApplicationRecord jobId={job.id} />}
  </section>
}
