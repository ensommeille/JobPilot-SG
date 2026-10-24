import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { getToken, watchSession } from '../services/auth'
import { fetchAIRecommendationRun, startAIRecommendations, type AIRecommendationRun } from '../services/aiRecommendations'
import type { JobId, JobView } from '../services/jobs'
import { applicationAssistanceLabel } from '../services/jobs'
import { jobDetailLocation } from '../services/jobBrowseState'
import JobAdvice from './JobAdvice'
import './AIRecommendations.css'

const validRunId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const errorMessages: Record<string, string> = {
  profile_required: 'Save your skills, education or project experience in your profile, then return to recommend jobs.',
  profile_needed: 'Save your skills, education or project experience in your profile, then return to recommend jobs.',
  no_candidates: 'No current jobs with enough profile relevance were found. You can show all jobs and review the original postings.',
  invalid_output: 'The model response could not be verified. No ranking is shown. You can still browse all jobs.',
  provider_unavailable: 'The AI provider is unavailable. Check the saved status before requesting recommendations again.',
  invalid_evidence: 'The model quotes could not be verified against the source text. No ranking is shown.',
}

function failureMessage(code: string | null) {
  return (code && errorMessages[code]) || 'Recommendations could not be completed. You can show all jobs, review your saved profile and explicitly try again.'
}

function requestMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback
  const detail = error.response?.data?.detail
  if (typeof detail === 'string' && errorMessages[detail]) return errorMessages[detail]
  if (error.response?.status === 401) return 'Your session ended. Sign in again to continue.'
  if (error.response?.status === 403) return 'Recommendations are not enabled for this account or environment.'
  if (error.response?.status === 404) return 'These saved recommendations are unavailable for your account. Show all jobs or request recommendations again.'
  if (error.response?.status === 422) return 'Save your skills, education or experience in your profile before requesting recommendations.'
  if (error.response?.status === 429) return 'The AI request limit has been reached. Check your existing result and try later.'
  if (error.response?.status === 503) return 'The AI model is unavailable here. Your saved profile and all jobs are still available.'
  return fallback
}

function timeLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })
}

interface Props {
  children: ReactNode
  jobs: JobView[]
  favorites: JobId[]
  favoritePending: JobId[]
  favoritesDisabled: boolean
  favoriteError: string
  onToggleFavorite: (event: MouseEvent, id: JobId) => Promise<void>
}

export default function AIRecommendations(props: Props) {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <RecommendationSession key={token ?? 'signed-out'} {...props} token={token} />
}

function RecommendationSession({ token, children, jobs, favorites, favoritePending, favoritesDisabled, favoriteError, onToggleFavorite }: Props & { token: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedRun = searchParams.get('ai_run') ?? ''
  const [recommendationView, setRecommendationView] = useState(Boolean(requestedRun))
  const viewRequested = useRef(recommendationView)
  const [report, setReport] = useState<AIRecommendationRun | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadingRun, setLoadingRun] = useState(false)
  const [runError, setRunError] = useState('')
  const [pollError, setPollError] = useState('')
  const [pollVersion, setPollVersion] = useState(0)
  const startRequest = useRef<AbortController | null>(null)
  const savedRunRequest = useRef<AbortController | null>(null)
  const savedRunGeneration = useRef(0)
  const busy = submitting || loadingRun || report?.status === 'running'

  useEffect(() => () => { startRequest.current?.abort(); savedRunRequest.current?.abort() }, [])

  useEffect(() => {
    const request = new AbortController()
    const generation = ++savedRunGeneration.current
    savedRunRequest.current?.abort()
    savedRunRequest.current = request
    const isCurrent = () => !request.signal.aborted && getToken() === token && viewRequested.current
      && savedRunRequest.current === request && savedRunGeneration.current === generation
    const load = async () => {
      if (!token || !requestedRun || !viewRequested.current) return
      if (!validRunId(requestedRun)) { setRunError('This saved result link is invalid. Show all jobs or request recommendations again.'); return }
      setLoadingRun(true)
      setRunError('')
      try {
        const response = await fetchAIRecommendationRun(requestedRun, {
          signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` },
        })
        if (isCurrent()) {
          setReport(previous => ({ ...response.data, reused: response.data.reused || Boolean(previous?.id === response.data.id && previous.reused) }))
          viewRequested.current = true
          setRecommendationView(true)
        }
      } catch (error) {
        if (isCurrent()) setRunError(requestMessage(error, 'Saved recommendations could not be loaded. Reload to check them; this does not start a new AI call.'))
      } finally {
        if (isCurrent()) setLoadingRun(false)
      }
    }
    void load()
    return () => { request.abort(); if (savedRunRequest.current === request) savedRunRequest.current = null }
  }, [requestedRun, token])

  const runId = report?.id
  const runStatus = report?.status
  useEffect(() => {
    if (!token || !runId || runStatus !== 'running' || !recommendationView) return
    const request = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    const poll = async () => {
      if (request.signal.aborted || getToken() !== token) return
      try {
        const response = await fetchAIRecommendationRun(runId, {
          signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` },
        })
        if (request.signal.aborted || getToken() !== token) return
        setPollError('')
        setReport(previous => ({ ...response.data, reused: response.data.reused || Boolean(previous?.id === response.data.id && previous.reused) }))
        attempts += 1
        if (response.data.status === 'running') {
          if (attempts < 60) timer = setTimeout(poll, 2500)
          else setPollError('Recommendations are still running. Automatic status checks have paused. Check saved status below; this does not start another AI call.')
        }
      } catch (error) {
        if (!request.signal.aborted && getToken() === token) setPollError(requestMessage(error, 'Status could not be refreshed. Check saved status below; no extra AI request will be sent.'))
      }
    }
    timer = setTimeout(poll, 1500)
    return () => { clearTimeout(timer); request.abort() }
  }, [runId, runStatus, token, pollVersion, recommendationView])

  function showAllJobs() {
    viewRequested.current = false
    savedRunGeneration.current += 1
    savedRunRequest.current?.abort()
    savedRunRequest.current = null
    setRecommendationView(false)
    setLoadingRun(false)
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('ai_run'); return next }, { replace: true })
  }

  async function recommendJobs() {
    if (report?.status === 'running' && !recommendationView) {
      viewRequested.current = true
      setRecommendationView(true)
      setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('ai_run', report.id); return next }, { replace: true })
      return
    }
    if (!token || getToken() !== token || startRequest.current || busy) return
    const request = new AbortController()
    startRequest.current = request
    viewRequested.current = true
    setRecommendationView(true)
    setSubmitting(true)
    setReport(null)
    setRunError('')
    setPollError('')
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('ai_run'); return next }, { replace: true })
    try {
      const response = await startAIRecommendations(undefined, {
        signal: request.signal, timeout: 90000, headers: { Authorization: `Bearer ${token}` },
      })
      if (request.signal.aborted || getToken() !== token) return
      setReport(response.data)
      if (viewRequested.current) setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('ai_run', response.data.id); return next }, { replace: true })
    } catch (error) {
      if (!request.signal.aborted && getToken() === token) setRunError(requestMessage(error, 'The request could not be confirmed. No automatic retry was sent. Click Recommend to me again to retrieve the same saved run if one was created.'))
    } finally {
      if (startRequest.current === request) startRequest.current = null
      if (!request.signal.aborted && getToken() === token) setSubmitting(false)
    }
  }

  const ranked = report?.status === 'succeeded' && report.result
    ? [...report.result.items].sort((a, b) => {
      if (report.is_current === false) return a.rank - b.rank
      const order = report.display_order ?? []
      const first = order.indexOf(a.job_id)
      const second = order.indexOf(b.job_id)
      return (first < 0 ? a.rank + order.length : first) - (second < 0 ? b.rank + order.length : second)
    }) : []

  return <div className="job-recommendation-view">
    <div className="recommendation-toolbar">
      <div>
        <button type="button" className="btn btn-primary" disabled={!token || submitting || loadingRun || (recommendationView && report?.status === 'running')} aria-describedby="recommendation-consent" onClick={() => { void recommendJobs() }}>{submitting || (recommendationView && report?.status === 'running') ? 'Finding recommendations…' : 'Recommend to me'}</button>
        {recommendationView && <button type="button" className="btn btn-secondary" onClick={showAllJobs}>Show all jobs</button>}
      </div>
      <p id="recommendation-consent" className="muted">Uses your saved profile to shortlist current jobs and compare up to 5 with AI. Clicking agrees to share saved skills, education, experience and availability; a new analysis may incur a charge. <Link to="/profile">Edit profile</Link></p>
      {!token && <p><Link to="/">Sign in</Link> and save your profile to get recommendations.</p>}
    </div>

    {!recommendationView ? children : <section className="ai-recommendations" aria-labelledby="recommendation-results-title" aria-busy={submitting || loadingRun || report?.status === 'running'}>
      <div className="ai-recommendations-heading">
        <h2 id="recommendation-results-title">{report?.is_current === false && report.status === 'succeeded' ? 'Historical comparison' : 'Recommended for you'}</h2>
        {report && <span className="ai-run-state">{report.execution_mode === 'mock' ? 'Mock preview' : 'Live AI'}{report.is_current === false ? `${report.reused ? ' · Saved result' : ''} · Out of date` : report.reused ? ' · Saved result' : ''}</span>}
      </div>
      {submitting && <p role="status">Finding relevant jobs and comparing them with your saved profile. This may take a minute. Leaving this view does not cancel a run already started.</p>}
      {loadingRun && <p role="status">Loading saved recommendations. No new AI call is being requested…</p>}
      {runError && <p role="alert" className="ai-error">{runError} <Link to="/profile">Review profile</Link></p>}
      {report?.execution_mode === 'mock' && <p className="ai-notice">This is a mock preview, not a live recommendation. Show all jobs to browse current postings.</p>}
      {report?.status === 'running' && <>
        <p role="status">Comparing {report.candidates.length} shortlisted jobs. Checking status does not call the AI model again.</p>
        <ul className="ai-running-jobs">{report.candidates.map(job => <li key={job.id}>{job.title} · {job.company}</li>)}</ul>
        {pollError && <p role="alert" className="ai-error">{pollError}</p>}
        <button type="button" className="btn btn-secondary" onClick={() => { setPollError(''); setPollVersion(value => value + 1) }}>Check saved status</button>
      </>}
      {report?.status === 'failed' && <p role="alert" className="ai-error">{failureMessage(report.error_code)}{report.error_code && <span className="ai-error-code">Reference: {report.error_code}</span>}</p>}
      {report?.status === 'succeeded' && <>
        {report.is_current !== false && <p className="muted">AI-assisted suggestions, not a hiring decision. Check key conditions before applying; supporting quotes are available below.</p>}
        {report.is_current === false ? <p className="ai-notice" role="status">Historical result: the profile, jobs or analysis rules have changed. Click Recommend to me for an up-to-date comparison; no new analysis starts automatically.</p>
          : <p className="muted">{ranked.length} shortlisted {ranked.length === 1 ? 'job' : 'jobs'}, ranked using your saved profile. Browse filters are paused in this view; Show all jobs restores them.</p>}
        {favoriteError && <p role="alert" className="ai-error">{favoriteError} Show all jobs to reload saved jobs.</p>}
        {!ranked.length && <p>No ranked jobs were returned. Show all jobs to review current postings.</p>}
        <ol className="ai-ranked-jobs">{ranked.map(item => {
          const candidate = report.candidates.find(value => value.id === item.job_id)
          const job = jobs.find(value => String(value.id) === item.job_id)
          const favoriteId = job?.id ?? item.job_id
          const saved = favorites.includes(favoriteId)
          return <li key={item.job_id}>
            <article className="ai-job-result">
              <div className="ai-job-heading">
                <div><h3><Link to={jobDetailLocation(item.job_id, searchParams.get('browse'), report.id)}>{candidate?.title || 'View job'}</Link></h3>
                  {candidate && <p className="muted">{candidate.company} · {candidate.city || 'City unspecified'} · {candidate.job_type || 'Type unspecified'}</p>}
                  {job?.source && report.is_current !== false && <p className="ai-job-source muted">Source: {job.source}{job.salaryText ? ` · ${job.salaryText}` : ''}</p>}
                  {job?.applicationAssistance && report.is_current !== false && <p className="ai-job-source muted">{applicationAssistanceLabel(job.applicationAssistance)}</p>}
                </div>
                <button type="button" className={`icon-btn ${saved ? 'saved' : ''}`} aria-label={`${saved ? 'Remove from saved' : 'Save job'}: ${candidate?.title || 'recommended job'}`} aria-pressed={saved} disabled={favoritesDisabled || favoritePending.includes(favoriteId)} onClick={event => { void onToggleFavorite(event, favoriteId) }}><svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg></button>
              </div>
              <JobAdvice assessment={item} advice={report.advice?.[item.job_id] ?? null} historical={report.is_current === false} />
              <div className="ai-actions">{report.is_current !== false && <Link to={`/jobs/${item.job_id}/prepare`} className="btn btn-secondary">Prepare application</Link>}<Link to={jobDetailLocation(item.job_id, searchParams.get('browse'), report.id)}>{report.is_current === false ? 'View current job' : 'View job and original posting'}</Link></div>
            </article>
          </li>
        })}</ol>
      </>}
      {report && <details className="ai-run-details"><summary>Analysis details</summary><p>{report.provider} · {report.model} · {timeLabel(report.started_at)}</p>{report.reused && <p>This view uses a saved result.</p>}<p>Uses the saved profile and job descriptions from this run. Save profile changes before requesting again. Identical inputs reuse the saved result.</p><p>{report.profile_skill_count} saved skill entries supplied. {report.candidates.length} jobs compared. Prompt version: {report.prompt_version}.</p><p>{report.usage.input_tokens === null && report.usage.output_tokens === null ? 'Token usage was not reported.' : `Input tokens: ${report.usage.input_tokens ?? 'not reported'} · Output tokens: ${report.usage.output_tokens ?? 'not reported'}`}</p></details>}
    </section>}
  </div>
}
