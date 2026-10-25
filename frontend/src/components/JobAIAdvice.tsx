import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { getToken, watchSession } from '../services/auth'
import { fetchSavedJobAIAssessment, startAIRecommendations, type SavedJobAIAssessment } from '../services/aiRecommendations'
import { JobAnalysisCoordinator } from '../services/jobAnalysisCoordinator'
import { applicationRecommendation } from '../services/jobFit'
import JobAdvice from './JobAdvice'
import './JobAIAdvice.css'

const analysis = new JobAnalysisCoordinator({
  digest: async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join(''),
  readMarker: key => sessionStorage.getItem(key),
  writeMarker: key => sessionStorage.setItem(key, 'started'),
  start: async (token, jobId, signal) => {
    if (getToken() !== token || signal.aborted) throw new Error('Account changed.')
    return (await startAIRecommendations([jobId], { signal, timeout: 90000, headers: { Authorization: `Bearer ${token}` } })).data
  },
})
watchSession(() => analysis.cancelOtherSessions(getToken()))

const statusMessages = {
  not_analyzed: 'Your application recommendation is not ready yet.',
  outdated: 'The previous recommendation is out of date.',
  running: 'AI is comparing your saved profile with this job…',
  failed: 'AI could not complete this recommendation. No repeat analysis was started.',
  unavailable: 'An application recommendation is unavailable for this job.',
}

function errorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback
  if (error.response?.status === 401) return 'Your session ended. Sign in again to view your recommendation.'
  if (error.response?.status === 403) return 'AI analysis is not enabled in this environment.'
  if (error.response?.status === 404) return 'This job or its saved recommendation is unavailable for your account.'
  if (error.response?.status === 422) return 'Save your skills, education or experience in your profile to get a recommendation.'
  if (error.response?.status === 429) return 'The AI request limit has been reached. You can still read this job.'
  if (error.response?.status === 503) return 'AI is unavailable. No recommendation was created.'
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
  const generation = useRef(0)
  const handledContexts = useRef(new Set<string>())
  const alive = useRef(false)
  const activeContext = useRef<string | null>(null)
  const activeWrite = useRef<string | null>(null)
  const savedStatus = saved?.status
  const contextHash = saved?.context_hash

  useEffect(() => { activeContext.current = contextHash ?? null }, [contextHash])

  const readSaved = useCallback(async (clearError = true) => {
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
      if (clearError || response.data.status === 'available') setError('')
      return response.data
    } catch (err) {
      if (isCurrent()) setError(errorMessage(err, 'Your recommendation could not be loaded. Refresh status to try this free lookup again.'))
      return null
    } finally { if (isCurrent()) setLoading(false) }
  }, [jobId, token])

  useEffect(() => {
    let mounted = true
    alive.current = true
    const refresh = () => { if (mounted) void readSaved() }
    queueMicrotask(refresh)
    window.addEventListener('focus', refresh)
    return () => { mounted = false; alive.current = false; generation.current += 1; readRequest.current?.abort(); window.removeEventListener('focus', refresh) }
  }, [readSaved])

  useEffect(() => {
    if (!active || !token || getToken() !== token || !savedStatus) return
    const context = contextHash
    if (!context || !/^[a-f0-9]{64}$/.test(context) || handledContexts.current.has(context)) return
    if (['failed', 'unavailable'].includes(savedStatus)) {
      handledContexts.current.add(context)
      analysis.rememberUnavailable(token, jobId, context)
      return
    }
    if (!['not_analyzed', 'outdated'].includes(savedStatus)) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled || !alive.current || getToken() !== token || handledContexts.current.has(context)) return
      handledContexts.current.add(context)
      activeWrite.current = context
      setSubmitting(true)
      setError('')
      void analysis.ensure(token, jobId, context).then(async outcome => {
        if (!alive.current || activeContext.current !== context || getToken() !== token || outcome.status === 'cancelled') return
        if (outcome.status === 'uncertain') setError(errorMessage(outcome.error, 'The analysis request could not be confirmed. No repeat AI call was sent.'))
        if (outcome.status === 'failed') setError('AI could not complete this recommendation. No repeat analysis was started.')
        const latest = await readSaved(false)
        if (!alive.current || getToken() !== token) return
        if (latest && ['not_analyzed', 'outdated'].includes(latest.status) && latest.context_hash === context && outcome.status !== 'uncertain' && outcome.status !== 'failed') {
          setError('An analysis was already requested for these inputs. No repeat AI call was sent.')
        }
      }).finally(() => { if (alive.current && getToken() === token && activeWrite.current === context) setSubmitting(false) })
    })
    return () => { cancelled = true }
  }, [active, token, jobId, savedStatus, contextHash, readSaved])

  useEffect(() => {
    if (saved?.status !== 'running' || !token) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0
    const poll = async () => {
      if (stopped || getToken() !== token) return
      const current = await readSaved(false)
      if (stopped || !current) return
      attempts += 1
      if (current.status === 'running' && attempts < 60) timer = setTimeout(poll, 2500)
      if (current.status === 'running' && attempts >= 60) setError('Analysis is still running. Automatic status checks have paused; no new AI call was sent.')
    }
    timer = setTimeout(poll, 1500)
    return () => { stopped = true; clearTimeout(timer) }
  }, [saved?.status, saved?.source_run_id, token, readSaved, pollVersion])

  const comparing = submitting && (!saved || ['not_analyzed', 'outdated', 'running'].includes(saved.status))
  const waiting = comparing || saved?.status === 'running'
  const latestRecommendationMissing = saved?.status === 'available' && !applicationRecommendation(saved.advice)
  return <section className="job-ai-advice" aria-labelledby="job-ai-advice-title" aria-busy={loading || waiting}>
    <h3 id="job-ai-advice-title">Application recommendation</h3>
    {!token ? <p><Link to="/">Sign in</Link> for a recommendation based on your saved profile.</p> : <>
      {loading && <p role="status">Loading your recommendation…</p>}
      {comparing && <p role="status">AI is comparing your profile with this job. A new analysis may incur a charge; saved results are reused.</p>}
      {error && <p className="job-ai-error" role="alert">{error}</p>}
      {!loading && saved?.status === 'available' && saved.assessment && <>
        {saved.execution_mode === 'mock' && <p className="job-ai-notice">Mock preview: this is not a live AI recommendation.</p>}
        <JobAdvice assessment={saved.assessment} advice={saved.advice} />
        <details className="job-ai-about"><summary>About this analysis</summary><p>AI-assisted guidance based on your saved profile and this job. Hiring decisions remain with the employer.</p><p>Saved result{saved.model ? ` · ${saved.model}` : ''}{saved.finished_at ? ` · ${new Date(saved.finished_at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}.</p></details>
      </>}
      {!loading && !comparing && saved && saved.status !== 'available' && <p role="status">{!active && ['not_analyzed', 'outdated'].includes(saved.status) ? 'This posting is closed; no new AI analysis was started.' : statusMessages[saved.status]}</p>}
      {!loading && active && saved && ['not_analyzed', 'outdated'].includes(saved.status) && !saved.context_hash && <p className="job-ai-meta">The latest recommendation is not ready in this service. No AI call was started.</p>}
      {!loading && !comparing && (error || latestRecommendationMissing || (saved && ['failed', 'unavailable'].includes(saved.status))) && <div className="job-ai-actions"><button type="button" className="btn btn-secondary" onClick={() => { setLoading(true); setPollVersion(value => value + 1); void readSaved() }}>Refresh status</button><Link to="/profile">Edit profile</Link></div>}
    </>}
  </section>
}
