import { useEffect, useState } from 'react'
import api from '../services/api'
import { sourceTime } from '../services/sourceStatus'
import './SourceFreshness.css'

interface Source {
  id: string
  name: string
  provider: string
  schedule: string | null
  status: string
  last_attempt_at: string | null
  last_success_at: string | null
  next_run_at: string | null
  active_jobs: number
}

export default function SourceFreshness() {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const request = new AbortController()
    api.get('/job-sources/status', { signal: request.signal, timeout: 15000 })
      .then(response => { if (!request.signal.aborted) setSources(response.data.sources) })
      .catch(() => { if (!request.signal.aborted) setError(true) })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => request.abort()
  }, [retry])
  return <section className="source-freshness" aria-label="Job source updates">
    {loading ? <p role="status">Checking job source updates…</p>
      : error ? <p role="alert">Source update times could not be loaded. <button className="link" onClick={() => { setError(false); setLoading(true); setRetry(value => value + 1) }}>Retry source updates</button></p>
        : sources.length === 0 ? <p>No public job sources have been configured yet.</p>
          : <details>
            <summary>Job sources · {sources.length} configured · View update times</summary>
            <p className="muted">Check the original posting before applying. An update plan does not guarantee a successful refresh.</p>
            <ul>{sources.map(source => <li key={source.id}>
              <div className="source-freshness-heading"><strong>{source.name}</strong><span>{source.provider} · {source.active_jobs} active {source.active_jobs === 1 ? 'listing' : 'listings'}</span></div>
              <p>Last successful check: <time dateTime={source.last_success_at ?? undefined}>{sourceTime(source.last_success_at)}</time></p>
              <p className="muted">{source.schedule === 'every:6h' ? 'Checks planned every 6 hours.' : source.schedule === 'every:24h' ? 'Checks planned daily.' : 'Checked manually.'} {source.next_run_at && <>Next due: {sourceTime(source.next_run_at)}.</>}</p>
              {['failed', 'degraded'].includes(source.status) && <p className="source-freshness-warning">{source.status === 'failed' ? 'The last check failed.' : 'The last check was incomplete.'} Previously saved listings are retained; their availability needs checking.</p>}
              {source.status === 'running' && <p role="status">Refresh in progress. The time above is the last successful check.</p>}
            </li>)}</ul>
          </details>}
  </section>
}
