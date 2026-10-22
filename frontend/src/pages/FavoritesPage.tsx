import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchFavorites, removeFavorite, normalizeFavoriteList } from '../services/jobs'
import type { JobId, JobView } from '../services/jobs'
import { getToken, watchSession } from '../services/auth'

const PAGE_SIZE = 20

const FavoritesPage = () => {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <SessionFavorites key={token ?? 'signed-out'} token={token} />
}

function SessionFavorites({ token }: { token: string | null }) {
  const [favorites, setFavorites] = useState<JobView[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [total, setTotal] = useState(0)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removeError, setRemoveError] = useState('')
  const [removingId, setRemovingId] = useState<JobId | null>(null)
  const removals = useRef(new Set<AbortController>())
  const navigate = useNavigate()

  useEffect(() => {
    const request = new AbortController()
    const current = () => !request.signal.aborted && getToken() === token
    const load = async () => {
      setFavorites([])
      setError('')
      setRemoveError('')
      setLoading(true)
      if (!token) {
        setLoading(false)
        setError('Sign in to JobPilot to view your saved jobs.')
        return
      }
      try {
        const res = await fetchFavorites(page, PAGE_SIZE, {
          signal: request.signal, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
        })
        if (!current()) return
        const lastPage = Math.max(1, res.data.pages)
        if (page > lastPage) { setPage(lastPage); return }
        setFavorites(normalizeFavoriteList(res.data))
        setTotal(res.data.total)
        setPages(res.data.pages)
      } catch {
        if (current()) setError('Could not load saved jobs. Check your connection and retry.')
      } finally {
        if (current()) setLoading(false)
      }
    }
    void load()
    return () => request.abort()
  }, [token, page, reload])

  useEffect(() => () => {
    for (const request of removals.current) request.abort()
    removals.current.clear()
  }, [])

  const handleRemove = async (id: JobId) => {
    if (!token || getToken() !== token || removals.current.size > 0) return
    const request = new AbortController()
    const current = () => !request.signal.aborted && getToken() === token
    removals.current.add(request)
    setRemovingId(id)
    setRemoveError('')
    try {
      await removeFavorite(id, {
        signal: request.signal, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
      })
      if (!current()) return
      const lastPage = Math.max(1, Math.ceil((total - 1) / PAGE_SIZE))
      if (page > lastPage) setPage(lastPage)
      else setReload(value => value + 1)
    } catch {
      if (current()) setRemoveError('Could not remove this saved job. Try the remove button again.')
    } finally {
      removals.current.delete(request)
      if (current()) setRemovingId(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <h2 style={{ marginBottom: '20px' }}>Saved Jobs</h2>

        {loading && <p role="status" style={{ textAlign: 'center', color: '#666' }}>Loading saved jobs...</p>}
        {error && <div role="alert" style={{ textAlign: 'center', color: '#dc2626' }}><p>{error}</p>
          {token ? <button className="btn btn-secondary" onClick={() => setReload(value => value + 1)}>Retry saved jobs</button>
            : <button className="btn btn-primary" onClick={() => navigate('/')}>Sign in</button>}
        </div>}
        {removeError && <p role="alert" style={{ color: '#dc2626' }}>{removeError}</p>}

        {!loading && !error && favorites.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', backgroundColor: 'white', borderRadius: '8px' }}>
            <p style={{ fontSize: '48px', margin: '0 0 16px 0' }}>☆</p>
            <p style={{ color: '#666' }}>No saved jobs yet.</p>
            <button onClick={() => navigate('/jobs')}
              style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8',
                color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Browse Jobs
            </button>
          </div>
        )}

        {!loading && !error && favorites.length > 0 && <>
          <p role="status">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} saved jobs</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {favorites.map(job => (
              <article key={job.id} aria-label={job.title}
                style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                  display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: '1 1 220px', overflowWrap: 'anywhere' }}>
                  <h3 style={{ margin: '0 0 4px 0' }}><Link to={`/jobs/${job.id}`}>{job.title}</Link></h3>
                  <p style={{ margin: '0 0 8px 0', color: '#666' }}>{job.company} · {job.location}</p>
                  <span style={{ backgroundColor: '#e8f0fe', color: '#1a73e8',
                    padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{job.type}</span>
                </div>
                <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                  {job.salaryText && (
                    <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: '#1a73e8' }}>{job.salaryText}</p>
                  )}
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#999' }}>
                    Deadline: {job.deadline ?? 'N/A'}
                  </p>
                  <button type="button" aria-label={`Remove saved job ${job.title}`}
                    disabled={removingId !== null} onClick={() => void handleRemove(job.id)}
                    style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b',
                      borderRadius: '4px', padding: '4px 12px', cursor: 'pointer',
                      color: '#f59e0b', fontSize: '13px' }}>
                    {removingId === job.id ? 'Removing...' : '★ Saved'}
                  </button>
                </div>
              </article>
            ))}
          </div>
          {pages > 1 && <nav aria-label="Saved jobs pages" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'center', marginTop: '20px' }}>
            <button className="btn btn-secondary btn-sm" disabled={page <= 1 || removingId !== null} onClick={() => setPage(value => value - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button className="btn btn-secondary btn-sm" disabled={page >= pages || removingId !== null} onClick={() => setPage(value => value + 1)}>Next</button>
          </nav>}
        </>}
      </div>
    </div>
  )
}

export default FavoritesPage
