import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { getToken, watchSession } from '../services/auth'
import {
  fetchAdminIdentity, fetchAdminOverview,
  type AdminPageResult, type AuditEventRead, type CrawlRunRead, type JobSourceRead,
} from '../services/admin'
import './AdminPage.css'

function timeLabel(value: string): string {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString('en-SG')
}

function Pager({ label, page, pages, total, onPage }: {
  label: string; page: number; pages: number; total: number; onPage: (page: number) => void
}) {
  if (total === 0) return null
  return <nav aria-label={`${label} pages`} className="admin-pager">
    <span>Page {page} of {pages} · {total} total</span>
    <div className="row">
      <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  </nav>
}

export default function AdminPage() {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <SessionAdminPage key={token ?? 'signed-out'} token={token} />
}

function SessionAdminPage({ token }: { token: string | null }) {
  const [sources, setSources] = useState<JobSourceRead[]>([])
  const [runs, setRuns] = useState<AdminPageResult<CrawlRunRead> | null>(null)
  const [audits, setAudits] = useState<AdminPageResult<AuditEventRead> | null>(null)
  const [runPage, setRunPage] = useState(1)
  const [auditPage, setAuditPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const request = new AbortController()
    const current = () => !request.signal.aborted && getToken() === token
    const load = async () => {
      setLoading(true)
      setError('')
      setSources([])
      setRuns(null)
      setAudits(null)
      if (!token) {
        setError('Sign in with an administrator account to view source operations.')
        setLoading(false)
        return
      }
      try {
        const identity = await fetchAdminIdentity(request.signal, token)
        if (!current()) return
        if (identity.data.role !== 'admin') {
          setError('Administrator access required. This account cannot view source operations.')
          return
        }
        const [sourceResult, runResult, auditResult] = await fetchAdminOverview(
          request.signal, token, runPage, auditPage,
        )
        if (!current()) return
        setSources(sourceResult.data)
        setRuns(runResult.data)
        setAudits(auditResult.data)
      } catch {
        if (current()) setError('Could not load source operations. Check your connection and retry.')
      } finally {
        if (current()) setLoading(false)
      }
    }
    void load()
    return () => request.abort()
  }, [token, runPage, auditPage, retry])

  const sourceNames = new Map(sources.map(source => [source.id, source.name]))

  return <div className="page">
    <Navbar />
    <main className="container admin-page">
      <header className="page-header">
        <h1>Source operations</h1>
        <p>Read-only visibility into configured job sources, collection runs and key audit events.</p>
      </header>

      {loading && <p role="status">Loading source operations…</p>}
      {error && <div role="alert" className="alert alert-error admin-error">
        <p>{error}</p>
        {token ? <button className="btn btn-secondary btn-sm" onClick={() => setRetry(value => value + 1)}>Retry</button>
          : <Link to="/" className="btn btn-secondary btn-sm">Sign in</Link>}
      </div>}

      {!loading && !error && <>
        <section className="admin-section" aria-labelledby="admin-sources-heading">
          <div className="admin-section-heading"><h2 id="admin-sources-heading">Configured sources</h2><span>{sources.length} shown</span></div>
          {sources.length === 0 ? <p className="muted">No sources have been configured.</p> :
            <ul className="admin-list">{sources.map(source => <li key={source.id} className="admin-list-item">
              <div><strong>{source.name}</strong><p className="admin-url">{source.base_url}</p></div>
              <div className="admin-facts"><span>{source.source_type}</span><span>{source.enabled ? source.status : 'disabled'}</span>
                <span>{source.schedule || 'No active schedule'}</span></div>
            </li>)}</ul>}
        </section>

        <section className="admin-section" aria-labelledby="admin-runs-heading">
          <div className="admin-section-heading"><h2 id="admin-runs-heading">Collection runs</h2><span>Most recent first</span></div>
          {!runs?.items.length ? <p className="muted">No collection runs recorded.</p> :
            <ul className="admin-list">{runs.items.map(run => <li key={run.id} className="admin-list-item">
              <div><strong>{sourceNames.get(run.source_id) || 'Unknown source'}</strong>
                <p className="muted">{timeLabel(run.created_at)} · {run.trigger}</p></div>
              <div className="admin-facts"><span className={`admin-status admin-status-${run.status}`}>{run.status}</span>
                <span>{run.items_found} found</span><span>{run.items_new} new</span>
                <span>{run.items_updated} updated</span><span>{run.items_failed} failed</span></div>
              {run.error_summary.length > 0 && <p className="admin-run-error">
                {run.error_summary.map((failure, index) => `${failure.stage || 'run'}: ${failure.error_type || 'failure'}${index < run.error_summary.length - 1 ? '; ' : ''}`)}
              </p>}
            </li>)}</ul>}
          {runs && <Pager label="Collection runs" page={runPage} pages={runs.pages} total={runs.total} onPage={setRunPage} />}
        </section>

        <section className="admin-section" aria-labelledby="admin-audit-heading">
          <div className="admin-section-heading"><h2 id="admin-audit-heading">Audit events</h2><span>Metadata and private values are not shown</span></div>
          {!audits?.items.length ? <p className="muted">No audit events recorded.</p> :
            <ul className="admin-list">{audits.items.map(event => <li key={event.id} className="admin-list-item">
              <div><strong>{event.action}</strong><p className="muted">{timeLabel(event.created_at)}</p></div>
              <div className="admin-facts"><span>{event.entity_type}</span>{event.entity_id && <span className="admin-entity">{event.entity_id}</span>}</div>
            </li>)}</ul>}
          {audits && <Pager label="Audit events" page={auditPage} pages={audits.pages} total={audits.total} onPage={setAuditPage} />}
        </section>
      </>}
    </main>
  </div>
}
