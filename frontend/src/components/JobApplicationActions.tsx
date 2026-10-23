import { Link } from 'react-router-dom'
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
  const active = job.status === 'active'
  const original = publicUrl(job.source_url) || publicUrl(job.apply_url)
  return <section className="stack" aria-label="Application options">
    {active ? <>
      <p>Review your saved details and resume, then continue through this employer's application channel.</p>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <Link className="btn btn-primary" to={`/jobs/${job.id}/prepare`}>Prepare application</Link>
        {original && <a className="btn btn-secondary" href={original} target="_blank" rel="noopener noreferrer">View original posting</a>}
      </div>
      <ManualApplicationRecord jobId={job.id} />
    </> : <>
      <p role="status">This job is not active. Check the original listing before applying.</p>
      {original && <a className="link" href={original} target="_blank" rel="noopener noreferrer">View original posting</a>}
    </>}
  </section>
}
