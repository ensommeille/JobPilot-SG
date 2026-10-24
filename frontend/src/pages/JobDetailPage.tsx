import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import JobMatchAnalysis from '../components/JobMatchAnalysis'
import JobApplicationActions from '../components/JobApplicationActions'
import { sourceTime } from '../services/sourceStatus'
import { fetchJobById, addFavorite, removeFavorite, formatSalary } from '../services/jobs'
import { getToken, watchSession } from '../services/auth'

interface Job {
  id: string
  status: string
  title: string
  company: string
  city: string | null
  job_type: string | null
  deadline: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  salary_period: string | null
  description?: string
  requirements?: string[]
  apply_url: string
  source_url: string | null
  assistant_form_available: boolean
  is_favorited: boolean
  source: { name: string; last_success_at?: string | null }
  last_seen_at?: string | null
  tags: { id: string; name: string }[]
}

const JobDetailPage = () => {
  const { id } = useParams()
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <SessionJobDetail key={`${id}:${token ?? ''}`} id={String(id)} token={token} />
}

const SessionJobDetail = ({ id, token }: { id: string; token: string | null }) => {
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFavorited, setIsFavorited] = useState(false)
  const [favLoading, setFavLoading] = useState(false)
  const [favError, setFavError] = useState('')
  const generation = useRef(0)
  const favoriteRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    const current = ++generation.current
    const request = new AbortController()
    const isCurrent = () => !request.signal.aborted && generation.current === current && getToken() === token
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetchJobById(id, {
          signal: request.signal, timeout: 15000,
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        })
        if (!isCurrent()) return
        setJob(res.data)
        setIsFavorited(Boolean(token && res.data.is_favorited))
      } catch {
        if (isCurrent()) setError('Job not found or failed to load.')
      } finally {
        if (isCurrent()) setLoading(false)
      }
    }
    load()
    return () => {
      generation.current = current + 1
      request.abort()
      favoriteRequest.current?.abort()
      favoriteRequest.current = null
    }
  }, [id, token])

  const toggleFavorite = async () => {
    if (!job || favoriteRequest.current || String(job.id) !== id || getToken() !== token) return
    if (!token) {
      setFavError('Sign in to JobPilot to save this job to your favorites.')
      return
    }
    const request = new AbortController()
    const current = generation.current
    const wasFavorited = isFavorited
    favoriteRequest.current = request
    const isCurrent = () => !request.signal.aborted && generation.current === current && getToken() === token
    const config = { signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } }
    setFavLoading(true)
    setFavError('')
    try {
      if (wasFavorited) {
        await removeFavorite(job.id, config)
      } else {
        await addFavorite(job.id, config)
      }
      if (isCurrent()) setIsFavorited(!wasFavorited)
    } catch {
      if (isCurrent()) setFavError('Could not update your favorites. Check your connection and try again.')
    } finally {
      if (favoriteRequest.current === request) favoriteRequest.current = null
      if (isCurrent()) setFavLoading(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo="/jobs" backLabel="← Back to Jobs" />
      <p style={{ textAlign: 'center', marginTop: '80px', color: '#666' }}>Loading...</p>
    </div>
  )

  if (error || !job) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo="/jobs" backLabel="← Back to Jobs" />
      <div style={{ textAlign: 'center', marginTop: '80px' }}>
        <p style={{ color: '#dc2626' }}>{error || 'Job not found'}</p>
        <button onClick={() => navigate('/jobs')}
          style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8',
            color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Back to Jobs
        </button>
      </div>
    </div>
  )

  return (
    <div className="job-detail-page" style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo="/jobs" backLabel="← Back to Jobs" />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <div style={{ backgroundColor: 'white', borderRadius: '8px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)', padding: '32px' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <h2 style={{ margin: '0 0 8px 0' }}>{job.title}</h2>
              <p style={{ margin: '0 0 8px 0', color: '#666', fontSize: '16px' }}>
                {job.company} · {job.city ?? 'Location not specified'}
              </p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ backgroundColor: '#e8f0fe', color: '#1a73e8',
                  padding: '4px 12px', borderRadius: '12px', fontSize: '13px' }}>{job.job_type}</span>
                {(job.tags ?? []).map(t => (
                  <span key={t.id} style={{ backgroundColor: '#f1f3f4', color: '#666',
                    padding: '4px 12px', borderRadius: '12px', fontSize: '13px' }}>{t.name}</span>
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {formatSalary(job) && (
                <p style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 'bold', color: '#1a73e8' }}>
                  {formatSalary(job)}
                </p>
              )}
              <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#999' }}>
                Deadline: {job.deadline ?? 'Not specified'}
              </p>
              <button onClick={toggleFavorite} disabled={favLoading} aria-pressed={isFavorited}
                aria-describedby={favError ? 'favorite-error' : undefined}
                style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer',
                  backgroundColor: isFavorited ? '#fef3c7' : 'white',
                  border: `1px solid ${isFavorited ? '#f59e0b' : '#ddd'}`,
                  color: isFavorited ? '#f59e0b' : '#666' }}>
                {isFavorited ? '★ Favorited' : '☆ Add to Favorites'}
              </button>
              {favError && <p id="favorite-error" role="alert" style={{ color: '#b91c1c', fontSize: '14px', maxWidth: '260px' }}>{favError}</p>}
            </div>
          </div>

          {/* Description */}
          <JobMatchAnalysis key={`match-${job.id}`} jobId={job.id} />
          {job.description && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ marginBottom: '8px' }}>Job Description</h3>
              <p style={{ color: '#444', lineHeight: '1.6' }}>{job.description}</p>
            </div>
          )}

          {/* Requirements */}
          {job.requirements && job.requirements.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ marginBottom: '8px' }}>Requirements</h3>
              <ul style={{ color: '#444', lineHeight: '2' }}>
                {job.requirements.map((req, i) => <li key={i}>{req}</li>)}
              </ul>
            </div>
          )}

          {/* Source */}
          {job.source && (
            <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>
              Source: {job.source.name} · Last successful source check: {sourceTime(job.source.last_success_at)}
            </p>
          )}

          {/* Actions */}
          <JobApplicationActions key={`actions-${job.id}`} job={job} />
        </div>
      </div>
    </div>
  )
}

export default JobDetailPage
