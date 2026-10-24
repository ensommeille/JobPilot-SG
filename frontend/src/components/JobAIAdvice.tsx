import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { getToken, watchSession } from '../services/auth'
import { fetchSavedJobAIAssessment, startAIRecommendations, type SavedJobAIAssessment } from '../services/aiRecommendations'
import JobAdvice from './JobAdvice'
import './JobAIAdvice.css'

const statusMessages = {
  not_analyzed: 'This job has not been compared with your saved profile yet.',
  outdated: 'Your profile, this job or the analysis rules have changed. The previous result is no longer current.',
  running: 'An analysis is already running for this job. Checking its status does not call the model again.',
  failed: 'The previous analysis did not produce a verified result. No application recommendation is shown.',
  unavailable: 'This job is not available for a current AI assessment. Review the original posting before applying.',
}

function errorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback
  if (error.response?.status === 401) return 'Your session ended. Sign in again to view your saved advice.'
  if (error.response?.status === 403) return 'AI analysis is not enabled in this environment.'
  if (error.response?.status === 404) return 'This job or its saved analysis is unavailable for your account.'
  if (error.response?.status === 422) return 'Save your skills, education or experience in your profile before analyzing this job.'
  if (error.response?.status === 429) return 'The AI request limit has been reached. You can still read this job and your saved information.'
  if (error.response?.status === 503) return 'The AI model is unavailable. No application recommendation was created.'
  return fallback
}

export default function JobAIAdvice({ jobId, active }: { jobId: string; active: boolean }) {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <JobAIAdviceSession key={`${jobId}:${token ?? 'signed-out'}`} jobId={jobId} active={active} token={token} />
}

function JobAIAdviceSession({ jobId, active, token }: { jobId: string; active: boolean; token: string | null }) {
  const [saved, setSaved] = useState<SavedJobAIAssessment | null>(null)
  const [loading, setLoading] = useState(Boolean(token))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [pollVersion, setPollVersion] = useState(0)
  const readRequest = useRef<AbortController | null>(null)
  const writeRequest = useRef<AbortController | null>(null)
  const generation = useRef(0)

  const readSaved = useCallback(async () => {
    if (!token || getToken() !== token) return null
    const request = new AbortController()
    const current = ++generation.current
    readRequest.current?.abort()
    readRequest.current = request
    const isCurrent = () => !request.signal.aborted && readRequest.current === request && current === generation.current && getToken() === token
    try {
      const response = await fetchSavedJobAIAssessment(jobId, { signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } })
      if (!isCurrent()) return null
      setSaved(response.data)
      setError('')
      return response.data
    } catch (err) {
      if (isCurrent()) setError(errorMessage(err, 'Saved advice could not be loaded. Check saved status to retry; this does not start an AI call.'))
      return null
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [jobId, token])

  useEffect(() => {
    let mounted = true
    queueMicrotask(() => { if (mounted) void readSaved() })
    return () => { mounted = false; generation.current += 1; readRequest.current?.abort(); writeRequest.current?.abort() }
  }, [readSaved])

  const savedStatus = saved?.status
  const savedRunId = saved?.source_run_id
  useEffect(() => {
    if (savedStatus !== 'running' || !token) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    const poll = async () => {
      if (stopped || getToken() !== token) return
      const current = await readSaved()
      if (stopped || !current) return
      attempts += 1
      if (current.status === 'running' && attempts < 60) timer = setTimeout(poll, 2500)
      if (current.status === 'running' && attempts >= 60) setError('Analysis is still running. Automatic checks have paused. Check saved status below; this does not start another AI call.')
    }
    timer = setTimeout(poll, 1500)
    return () => { stopped = true; clearTimeout(timer) }
  }, [savedStatus, savedRunId, token, readSaved, pollVersion])

  async function analyzeThisJob() {
    if (!token || getToken() !== token || writeRequest.current || submitting || loading || saved?.status === 'running' || saved?.status === 'available' || !active) return
    const request = new AbortController()
    writeRequest.current = request
    setSubmitting(true)
    setError('')
    try {
      await startAIRecommendations([jobId], { signal: request.signal, timeout: 90000, headers: { Authorization: `Bearer ${token}` } })
      if (!request.signal.aborted && getToken() === token) { setLoading(true); await readSaved() }
    } catch (err) {
      if (!request.signal.aborted && getToken() === token) setError(errorMessage(err, 'The request could not be confirmed. No automatic retry was sent. Check saved status before deciding whether to request analysis again.'))
    } finally {
      if (writeRequest.current === request) writeRequest.current = null
      if (!request.signal.aborted && getToken() === token) setSubmitting(false)
    }
  }

  const canAnalyze = active && saved && ['not_analyzed', 'outdated', 'failed'].includes(saved.status)
  return <section className="job-ai-advice" aria-labelledby="job-ai-advice-title" aria-busy={loading || submitting || saved?.status === 'running'}>
    <h3 id="job-ai-advice-title">Should I apply?</h3>
    {!token ? <p><Link to="/">Sign in</Link> to see advice based on your saved profile.</p> : <>
      {loading && <p role="status">Checking saved advice. This does not call the AI model…</p>}
      {submitting && <p role="status">Comparing this job with your saved profile. This may take a minute. Leaving the page does not cancel a run already started.</p>}
      {error && <p className="job-ai-error" role="alert">{error}</p>}
      {!loading && saved?.status === 'available' && saved.assessment && <>
        {saved.execution_mode === 'mock' && <p className="job-ai-notice">Mock preview: this is not a live AI recommendation.</p>}
        {saved.execution_mode === 'live' && <p className="job-ai-meta">AI-assisted advice, not a hiring decision. Check key conditions before applying.</p>}
        <JobAdvice assessment={saved.assessment} advice={saved.advice} />
        <p className="job-ai-meta">Saved analysis{saved.model ? ` · ${saved.model}` : ''}{saved.finished_at ? ` · ${new Date(saved.finished_at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. Opening this page did not call the model.</p>
      </>}
      {!loading && saved && saved.status !== 'available' && <p role="status">{statusMessages[saved.status]}</p>}
      {canAnalyze && !loading && <>
        <p className="job-ai-consent muted">Clicking Analyze this job shares saved skills, education, experience and availability with the AI provider. A new analysis may incur a charge; identical inputs reuse saved results.</p>
        <div className="job-ai-actions"><button type="button" className="btn btn-primary" disabled={submitting} onClick={() => { void analyzeThisJob() }}>Analyze this job</button><Link to="/profile">Edit profile</Link></div>
      </>}
      {((saved?.status === 'running' || error) && !loading) && <button type="button" className="btn btn-secondary" disabled={submitting} onClick={() => { setLoading(true); setPollVersion(value => value + 1); void readSaved() }}>Check saved status</button>}
    </>}
  </section>
}
