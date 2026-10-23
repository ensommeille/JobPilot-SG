import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { getToken, watchSession } from '../services/auth'
import {
  fetchAICandidates, fetchAIRecommendationRun, startAIRecommendations,
  type AICandidateFilters, type AICandidatePreview, type AIRecommendationRun,
} from '../services/aiRecommendations'
import './AIRecommendations.css'

const validRunId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
const outcomeLabels = { supported: 'Supported', gap: 'Gap', unknown: 'Unknown' }
const fieldLabels = { skills: 'Saved skills', education: 'Saved education', experience: 'Saved experience' }
const categoryLabels = {
  skill: 'Skill', responsibility: 'Responsibility', education: 'Education',
  experience: 'Experience', work_constraint: 'Work condition', other: 'Other requirement',
}
const errorMessages: Record<string, string> = {
  profile_required: 'Save your skills, education or project experience in your profile before comparing jobs.',
  profile_needed: 'Save your skills, education or project experience in your profile before comparing jobs.',
  no_candidates: 'No jobs are available for this comparison. Reload candidates and choose current postings.',
  invalid_output: 'The model response could not be verified. No ranking is shown. Review the original jobs before trying again.',
  provider_unavailable: 'The AI provider is unavailable. Check the saved run status before requesting another comparison.',
  invalid_evidence: 'The model quotes could not be verified against the source text. No ranking is shown.',
}

function failureMessage(code: string | null) {
  return (code && errorMessages[code]) || 'This AI comparison could not be completed. Review your saved profile and selected jobs, then explicitly request another comparison if needed.'
}

function requestMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback
  if (error.response?.status === 401) return 'Your session ended. Sign in again to continue.'
  if (error.response?.status === 403) return 'AI recommendations are not enabled for this account or environment.'
  if (error.response?.status === 404) return 'This saved comparison is unavailable for your account. Choose jobs to start a new comparison.'
  if (error.response?.status === 422) return 'Review your saved profile and select between one and five current jobs.'
  if (error.response?.status === 429) return 'The AI request limit has been reached. Check your existing result and try later.'
  if (error.response?.status === 503) return 'AI recommendations are not configured or available here. Your profile and jobs are still available.'
  return fallback
}

function timeLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AIRecommendations() {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <AIRecommendationsSession key={token ?? 'signed-out'} token={token} />
}

function AIRecommendationsSession({ token }: { token: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedRun = searchParams.get('ai_run') ?? ''
  const [filters, setFilters] = useState<AICandidateFilters>({ keyword: '', city: '', job_type: '' })
  const [preview, setPreview] = useState<AICandidatePreview | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [candidateError, setCandidateError] = useState('')
  const [report, setReport] = useState<AIRecommendationRun | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadingRun, setLoadingRun] = useState(false)
  const [runError, setRunError] = useState('')
  const [pollError, setPollError] = useState('')
  const [pollVersion, setPollVersion] = useState(0)
  const candidateRequest = useRef<AbortController | null>(null)
  const startRequest = useRef<AbortController | null>(null)
  const busy = submitting || loadingRun || report?.status === 'running'

  useEffect(() => () => {
    candidateRequest.current?.abort()
    startRequest.current?.abort()
  }, [])

  useEffect(() => {
    const request = new AbortController()
    const load = async () => {
      if (!token || !requestedRun) return
      if (!validRunId(requestedRun)) { setRunError('The saved comparison link is invalid. Choose jobs below to start a comparison.'); return }
      setLoadingRun(true)
      setRunError('')
      try {
        const response = await fetchAIRecommendationRun(requestedRun, {
          signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` },
        })
        if (!request.signal.aborted && getToken() === token) {
          setReport(previous => ({ ...response.data, reused: response.data.reused || Boolean(previous?.id === response.data.id && previous.reused) }))
        }
      } catch (error) {
        if (!request.signal.aborted && getToken() === token) setRunError(requestMessage(error, 'The saved comparison could not be loaded. Reload this page to check it; loading a saved run does not start a new AI call.'))
      } finally {
        if (!request.signal.aborted && getToken() === token) setLoadingRun(false)
      }
    }
    void load()
    return () => request.abort()
  }, [requestedRun, token])

  const runId = report?.id
  const runStatus = report?.status
  useEffect(() => {
    if (!token || !runId || runStatus !== 'running') return
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
          else setPollError('The comparison is still running. Automatic status checks have paused. Check status below; this does not start another AI call.')
        }
      } catch (error) {
        if (!request.signal.aborted && getToken() === token) setPollError(requestMessage(error, 'The status could not be refreshed. Check status below; no extra AI request will be sent.'))
      }
    }
    timer = setTimeout(poll, 1500)
    return () => { clearTimeout(timer); request.abort() }
  }, [runId, runStatus, token, pollVersion])

  function changeFilter(key: keyof AICandidateFilters, value: string) {
    candidateRequest.current?.abort()
    candidateRequest.current = null
    setLoadingCandidates(false)
    setPreview(null)
    setSelected([])
    setConfirmed(false)
    setCandidateError('')
    setFilters(previous => ({ ...previous, [key]: value }))
  }

  async function loadCandidates() {
    if (!token || getToken() !== token || loadingCandidates || busy) return
    candidateRequest.current?.abort()
    const request = new AbortController()
    candidateRequest.current = request
    setLoadingCandidates(true)
    setCandidateError('')
    setSelected([])
    setConfirmed(false)
    try {
      const response = await fetchAICandidates(filters, {
        signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` },
      })
      if (!request.signal.aborted && getToken() === token) setPreview(response.data)
    } catch (error) {
      if (!request.signal.aborted && getToken() === token) setCandidateError(requestMessage(error, 'Candidate jobs could not be loaded. Try loading them again; this does not call the AI provider.'))
    } finally {
      if (candidateRequest.current === request) candidateRequest.current = null
      if (!request.signal.aborted && getToken() === token) setLoadingCandidates(false)
    }
  }

  function toggleJob(id: string) {
    setConfirmed(false)
    setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : previous.length < 5 ? [...previous, id] : previous)
  }

  async function runComparison(event: React.FormEvent) {
    event.preventDefault()
    if (!token || getToken() !== token || startRequest.current || busy || !confirmed || !preview?.profile_ready || selected.length < 1 || selected.length > 5) return
    const request = new AbortController()
    startRequest.current = request
    setSubmitting(true)
    setRunError('')
    setPollError('')
    try {
      const response = await startAIRecommendations(selected, {
        signal: request.signal, timeout: 90000, headers: { Authorization: `Bearer ${token}` },
      })
      if (request.signal.aborted || getToken() !== token) return
      setReport(response.data)
      setSearchParams(previous => { const next = new URLSearchParams(previous); next.set('ai_run', response.data.id); return next }, { replace: true })
    } catch (error) {
      if (!request.signal.aborted && getToken() === token) setRunError(requestMessage(error, 'The request could not be confirmed. No automatic retry was sent. Retry the same selection to retrieve an existing run if one was created.'))
    } finally {
      if (startRequest.current === request) startRequest.current = null
      if (!request.signal.aborted && getToken() === token) { setSubmitting(false); setConfirmed(false) }
    }
  }

  const ranked = report?.status === 'succeeded' && report.result
    ? [...report.result.items].sort((a, b) => a.rank - b.rank) : []

  return <section className="ai-recommendations" aria-labelledby="ai-recommendations-title">
    <div className="ai-recommendations-heading">
      <h2 id="ai-recommendations-title">AI recommendations</h2>
      <Link to="/profile?returnTo=%2Fjobs">Review saved profile</Link>
    </div>
    <p>Ask the configured AI model to compare selected job descriptions with your saved skills, education and project experience. Review its ranking, reasons and source quotes before deciding where to apply.</p>
    <p className="muted">This uses paid AI when a new comparison is needed. PDF files and contact fields are excluded. Saved results may be reused; loading candidates or checking a saved result does not call the model.</p>
    {!token ? <p className="ai-notice"><Link to="/">Sign in</Link> and save your reviewed profile to select jobs for an AI comparison.</p>
      : <form onSubmit={runComparison}>
        <div className="ai-candidate-filters">
          <label>Role or company (optional)<input className="input" maxLength={200} disabled={busy} value={filters.keyword} onChange={event => changeFilter('keyword', event.target.value)} /></label>
          <label>City (optional)<input className="input" maxLength={120} disabled={busy} placeholder="Singapore" value={filters.city} onChange={event => changeFilter('city', event.target.value)} /></label>
          <label>Job type (optional)<input className="input" maxLength={80} disabled={busy} placeholder="internship" value={filters.job_type} onChange={event => changeFilter('job_type', event.target.value)} /></label>
        </div>
        <div className="ai-actions"><button type="button" className="btn btn-secondary" disabled={loadingCandidates || busy} onClick={() => { void loadCandidates() }}>{loadingCandidates ? 'Loading candidates…' : 'Load candidate jobs'}</button><span className="muted">No AI call</span></div>
        {loadingCandidates && <p role="status">Finding current candidates from saved jobs…</p>}
        {candidateError && <p role="alert" className="ai-error">{candidateError}</p>}
        {preview && <>
          {!preview.profile_ready && <p className="ai-notice">Add saved skills, education or experience in <Link to="/profile?returnTo=%2Fjobs">your profile</Link>, then reload candidates. Uploading a PDF alone does not save its suggestions.</p>}
          {preview.candidates.length ? <fieldset className="ai-candidates" disabled={busy || !preview.profile_ready}>
            <legend>Choose 1–5 jobs to compare</legend>
            <p className="muted">These are candidates for review. This list is not an AI ranking or an eligibility assessment.</p>
            <ul>{preview.candidates.map(job => <li key={job.id}>
              <label className="ai-candidate-choice"><input type="checkbox" checked={selected.includes(job.id)} disabled={!selected.includes(job.id) && selected.length >= 5} onChange={() => toggleJob(job.id)} /><span><strong>{job.title}</strong><span className="muted">{job.company} · {job.city || 'City unspecified'} · {job.job_type || 'Type unspecified'}</span></span></label>
              <Link to={`/jobs/${job.id}`} target="_blank" rel="noopener noreferrer">Review job<span className="ai-sr-only">: {job.title}</span></Link>
            </li>)}</ul>
          </fieldset> : <p className="ai-notice">No candidate jobs were found. Clear a filter and load candidates again, or browse stored jobs below.</p>}
          {preview.truncated && <p className="muted">Showing a limited candidate set from {preview.scanned} scanned jobs. Narrow the filters to explore other roles.</p>}
          {!!preview.candidates.length && <>
            <p role="status" className="ai-selection-count">{selected.length} of 5 selected.{selected.length === 5 ? ' Uncheck a job before adding another.' : ''}</p>
            <label className="ai-consent"><input type="checkbox" checked={confirmed} disabled={busy || !preview.profile_ready || selected.length === 0} onChange={event => setConfirmed(event.target.checked)} /><span>I confirm these selected jobs and agree to share my saved skills, education and experience with the configured AI provider for this comparison. A new run may incur an AI charge.</span></label>
            <div className="ai-actions"><button className="btn btn-primary" disabled={busy || loadingCandidates || !confirmed || !preview.profile_ready || selected.length === 0}>{submitting ? 'Requesting comparison…' : `Compare ${selected.length || 'selected'} ${selected.length === 1 ? 'job' : 'jobs'} with AI`}</button></div>
          </>}
        </>}
      </form>}
    {submitting && <p role="status">Waiting for the AI comparison. This may take a minute. Leaving this page stops waiting here; it does not cancel a run already started on the server. No automatic model retry is sent.</p>}
    {loadingRun && <p role="status">Loading saved AI comparison. No new model call is being requested…</p>}
    {runError && <p role="alert" className="ai-error">{runError}</p>}
    {report && <section className="ai-comparison" aria-labelledby="ai-result-title" aria-busy={report.status === 'running'}>
      <div className="ai-recommendations-heading"><h3 id="ai-result-title">{report.status === 'running' ? 'AI comparison in progress' : report.status === 'failed' ? 'AI comparison unavailable' : 'AI comparison to review'}</h3><span className="ai-run-state">{report.execution_mode === 'mock' ? 'Mock preview' : 'Live AI'}{report.reused ? ' · Reused saved run' : ''}</span></div>
      <p className="muted">{report.provider} · {report.model} · Requested {timeLabel(report.started_at)}</p>
      <p className="muted">This result uses the saved profile and job descriptions from this run. After saving profile changes, explicitly request a new comparison to use them.</p>
      {report.execution_mode === 'mock' && <p className="ai-notice">This is a mock preview, not a live model recommendation.</p>}
      {report.status === 'running' && <>
        <p role="status">Comparing {report.candidates.length} selected jobs. Status checks do not start another AI call. Leaving this page does not cancel the server run.</p>
        <ul className="ai-running-jobs">{report.candidates.map(job => <li key={job.id}>{job.title} · {job.company}</li>)}</ul>
        {pollError && <p role="alert" className="ai-error">{pollError}</p>}
        <button type="button" className="btn btn-secondary" onClick={() => { setPollError(''); setPollVersion(value => value + 1) }}>Check saved status</button>
      </>}
      {report.status === 'failed' && <p role="alert" className="ai-error">{failureMessage(report.error_code)}{report.error_code && <span className="ai-error-code">Reference: {report.error_code}</span>}</p>}
      {report.status === 'succeeded' && <>
        <p className="ai-notice">Model suggestions require review. Supported, Gap and Unknown describe the model’s reading of the saved evidence; they do not verify proficiency, eligibility or employer acceptance.</p>
        {!ranked.length && <p>No ranked jobs were returned. Review the selected postings directly.</p>}
        <ol className="ai-ranked-jobs">{ranked.map((item, index) => {
          const job = report.candidates.find(candidate => candidate.id === item.job_id)
          return <li key={item.job_id}>
            <p className="ai-rank">AI order {item.rank}</p>
            <h3><Link to={`/jobs/${item.job_id}`}>{job?.title || 'View selected job'}</Link></h3>
            {job && <p className="muted">{job.company} · {job.city || 'City unspecified'} · {job.job_type || 'Type unspecified'}</p>}
            <p className="ai-summary">{item.summary}</p>
            {!!item.warnings.length && <ul className="ai-warnings">{item.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}</ul>}
            <details open={index === 0} className="ai-evidence-details"><summary>Review {item.requirements.length} requirements and source quotes</summary>
              <ul className="ai-requirements">{item.requirements.map((requirement, requirementIndex) => <li key={requirementIndex}>
                <div className="ai-requirement-heading"><h4>{requirement.requirement}</h4><strong className={`ai-outcome ai-outcome-${requirement.outcome}`}>{outcomeLabels[requirement.outcome]}</strong></div>
                <p className="muted">{categoryLabels[requirement.category]} · Model assessment</p>
                <p>{requirement.reason}</p>
                <dl className="ai-quotes"><div><dt>Job description quote</dt><dd>{requirement.jd_quote}</dd></div><div><dt>{requirement.profile_field ? fieldLabels[requirement.profile_field] : 'Saved profile evidence'}</dt><dd>{requirement.profile_quote || 'No explicit saved evidence cited. More information or manual review is needed.'}</dd></div></dl>
              </li>)}</ul>
            </details>
            <div className="ai-actions"><Link to={`/jobs/${item.job_id}`}>View job and original posting</Link><Link to={`/jobs/${item.job_id}/prepare`}>Prepare application</Link></div>
          </li>
        })}</ol>
      </>}
      <details className="ai-run-details"><summary>Comparison details</summary><p>Provider: {report.provider}. Model: {report.model}. Prompt version: {report.prompt_version}.</p><p>{report.profile_skill_count} saved skill entries supplied. {report.candidates.length} jobs selected.</p><p>{report.usage.input_tokens === null && report.usage.output_tokens === null ? 'Token usage was not reported.' : `Input tokens: ${report.usage.input_tokens ?? 'not reported'} · Output tokens: ${report.usage.output_tokens ?? 'not reported'}`}</p></details>
    </section>}
  </section>
}
