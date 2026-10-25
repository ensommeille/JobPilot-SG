import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import JobAIAdvice from '../components/JobAIAdvice'
import JobDescription, { type DescriptionBlock } from '../components/JobDescription'
import JobApplicationActions from '../components/JobApplicationActions'
import { sourceTime } from '../services/sourceStatus'
import { fetchJobById, addFavorite, removeFavorite, formatSalary } from '../services/jobs'
import { getToken, watchSession } from '../services/auth'
import './JobDetailPage.css'
import { readJobBrowseState, serializeJobBrowseState } from '../services/jobBrowseState'

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
  description_blocks?: DescriptionBlock[] | null
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
  const [searchParams] = useSearchParams()
  const returnRun = searchParams.get('recommendation_run') || ''
  const backParams = new URLSearchParams()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(returnRun)) backParams.set('ai_run', returnRun)
  const browse = serializeJobBrowseState(readJobBrowseState(searchParams.get('browse')))
  if (browse) backParams.set('browse', browse)
  const backTo = `/jobs${backParams.size ? `?${backParams}` : ''}`
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

  if (loading) return <div className="page job-detail-page">
    <Navbar backTo={backTo} backLabel="Back to Jobs" />
    <main className="job-detail-container"><p role="status">Loading job…</p></main>
  </div>

  if (error || !job) return <div className="page job-detail-page">
    <Navbar backTo={backTo} backLabel="Back to Jobs" />
    <main className="job-detail-container"><p className="alert alert-error" role="alert">{error || 'Job not found'}</p><button type="button" className="btn btn-secondary" onClick={() => navigate(backTo)}>Back to Jobs</button></main>
  </div>

  return <div className="page job-detail-page">
    <Navbar backTo={backTo} backLabel="Back to Jobs" />
    <main className="job-detail-container">
      <article className="card job-detail-content">
        <header className="job-detail-heading">
          <div className="job-detail-title">
            <h1>{job.title}</h1>
            <p className="muted">{job.company} · {job.city ?? 'Location not specified'}</p>
            <div className="job-tags"><span className="tag tag-primary">{job.job_type}</span>{(job.tags ?? []).map(tag => <span key={tag.id} className="tag">{tag.name}</span>)}</div>
          </div>
          <div className="job-detail-summary">
            {formatSalary(job) && <p className="salary">{formatSalary(job)}</p>}
            <p className="muted">Deadline: {job.deadline ?? 'Not specified'}</p>
            <button type="button" className="btn btn-secondary" onClick={toggleFavorite} disabled={favLoading} aria-pressed={isFavorited} aria-describedby={favError ? 'favorite-error' : undefined}>{isFavorited ? 'Saved job' : 'Save job'}</button>
            {favError && <p id="favorite-error" className="job-detail-error" role="alert">{favError}</p>}
          </div>
        </header>
        <JobAIAdvice key={`advice-${job.id}`} jobId={job.id} active={job.status === 'active'} />
        <JobDescription description={job.description} blocks={job.description_blocks} />
        {!!job.requirements?.length && <section className="job-description" aria-labelledby="job-requirements-title"><h3 id="job-requirements-title">Requirements</h3><ul>{job.requirements.map((requirement, index) => <li key={index}>{requirement}</li>)}</ul></section>}
        {job.source && <p className="job-detail-source muted">Source: {job.source.name} · Last successful source check: {sourceTime(job.source.last_success_at)}</p>}
        <JobApplicationActions key={`actions-${job.id}`} job={job} />
      </article>
    </main>
  </div>
}

export default JobDetailPage
