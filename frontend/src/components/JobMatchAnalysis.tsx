import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import api from '../services/api'
import { getToken, watchSession } from '../services/auth'
import { RequirementConditions, WorkConstraints } from './RequirementEvidence'
import type { StructuredRequirement, WorkConstraintEvidence } from './RequirementEvidence'
import './JobMatchAnalysis.css'

interface MatchItem extends StructuredRequirement {
  category: string
  requirement: string
  importance: 'required' | 'preferred' | 'unspecified'
  outcome: 'supported' | 'gap' | 'unknown'
  reason: string
  job_evidence: string
  profile_evidence: string | null
  profile_field: string | null
  skill_overlaps?: {skill_id: string; label: string; kind: 'specific' | 'general'; profile_evidence: string}[]
}
interface Analysis {
  status: 'preliminary' | 'unavailable'
  reason: string | null
  warnings: string[]
  items: MatchItem[]
  work_constraints?: WorkConstraintEvidence[]
  summary?: {value: string; evidence: string} | null
  responsibilities?: {value: string; evidence: string; priority: 'primary' | 'secondary' | 'conditional' | 'unspecified'; condition: {value: string; evidence: string} | null}[]
}
const reasons: Record<string, string> = {
  missing_extraction: 'This job has no extracted requirements yet. Its requirements need to be prepared before analysis.',
  stale_extraction: 'The job changed after its requirements were extracted. Updated extraction is needed before analysis.',
  invalid_extraction: 'The stored requirements could not be verified. They need to be regenerated before analysis.',
  extraction_running: 'Requirement extraction is still running. Try again after it finishes.',
  extraction_failed: 'Requirement extraction failed. It needs to be retried before analysis.',
  no_requirements: 'No comparable applicant requirements were extracted. Read the original description; this does not mean there are no requirements.',
}
const groups = [
  {key: 'supported', title: 'Exact skill entries shared', empty: 'No unconditional skill entries shared. This is not a rejection.'},
  {key: 'overlap', title: 'Shared skill mentions — conditions unverified', empty: 'No further explicit skill mentions shared.'},
  {key: 'gap', title: 'Explicit gaps to review', empty: 'No explicit contradictions found. This does not establish eligibility.'},
  {key: 'unknown', title: 'Information missing or manual review needed', empty: 'No additional extracted items to review. Extraction may still be incomplete.'},
] as const

function inGroup(item: MatchItem, group: typeof groups[number]['key']) {
  const partial = item.outcome === 'unknown' && !!item.skill_overlaps?.length
  return group === 'overlap' ? partial : item.outcome === group && !partial
}

export default function JobMatchAnalysis({jobId}: {jobId: string}) {
  const [result, setResult] = useState<Analysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const unwatch = watchSession(() => {
        controller.current?.abort(); setResult(null); setBusy(false); setError('Account changed. Analyze again after signing in.')
    })
    return () => { controller.current?.abort(); unwatch() }
  }, [])

  async function analyze() {
    const token = getToken()
    if (!token) { setResult(null); setError('Sign in to JobPilot before analyzing your profile.'); return }
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true); setError(''); setResult(null)
    try {
      const response = await api.post<Analysis>(`/jobs/${jobId}/match-analysis`, {}, {signal: request.signal, timeout: 15000, headers: {Authorization: `Bearer ${token}`}})
      if (request.signal.aborted) return
      if (getToken() !== token) { setError('Account changed. Analyze again.'); return }
      setResult(response.data)
    } catch (err) {
      if (!request.signal.aborted) setError(axios.isAxiosError(err) && err.response?.status === 404
        ? 'This job is no longer available. Return to the jobs list.'
        : 'Could not analyze this job. Check your connection and try again.')
    } finally {
      if (controller.current === request) setBusy(false)
    }
  }

  return <section className="job-match" aria-labelledby="job-match-title" aria-busy={busy}>
    <h3 id="job-match-title">How does this job fit your profile?</h3>
    <p>Compare saved skill descriptions with quoted job requirements. Shared skill names do not verify proficiency or overall suitability.</p>
    <div className="job-match-actions">
      <button className="btn btn-primary" disabled={busy} onClick={analyze}>{busy ? 'Analyzing…' : result ? 'Analyze again' : 'Analyze my match'}</button>
      <Link to="/profile">Update my profile</Link>
    </div>
    {busy && <p role="status">Reading your latest saved profile and this job’s requirements…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <>
      <div className="job-match-notice" role="status">
        <strong>{result.status === 'preliminary' ? 'Preliminary evidence comparison — not an eligibility decision' : 'Analysis unavailable'}</strong>
        {result.reason && <p>{reasons[result.reason] || 'Requirements are not ready for comparison.'}</p>}
        {result.warnings.map(warning => <p key={warning}>{warning}</p>)}
      </div>
      {result.status === 'preliminary' && <>
        <p>Based on your saved profile at the time of analysis. After changing your profile, choose Analyze again. Uploaded resume files are not parsed by this feature.</p>
        {(result.summary || !!result.responsibilities?.length) && <details>
          <summary>Extracted role and responsibilities (unverified)</summary>
          {result.summary && <><p>{result.summary.value}</p><details><summary>Role summary evidence</summary><blockquote>{result.summary.evidence}</blockquote></details></>}
          <ul>{result.responsibilities?.map((duty, index) => <li key={index}>
            <p><strong>{duty.priority === 'unspecified' ? 'Priority not stated' : duty.priority === 'conditional' ? 'Conditional responsibility' : duty.priority === 'primary' ? 'Primary responsibility' : 'Secondary responsibility'}:</strong> {duty.value}</p>
            {duty.condition && <p>Applies when: {duty.condition.value}</p>}
            <details><summary>Responsibility evidence</summary><blockquote>{duty.evidence}</blockquote>
              {duty.condition && <blockquote>{duty.condition.evidence}</blockquote>}</details>
          </li>)}</ul>
        </details>}
        {groups.map(group => <div className="job-match-group" key={group.key}>
          <h4>{group.title}</h4>
          {result.items.some(item => inGroup(item, group.key)) ? <ul>
            {result.items.filter(item => inGroup(item, group.key)).map((item, index) => <li key={group.key + index}>
              <p><strong>{item.requirement}</strong> <span className="job-match-importance">{item.importance === 'unspecified' ? 'Priority not classified' : item.importance === 'required' ? 'Required · model-labelled, unverified' : 'Preferred · model-labelled, unverified'}</span></p>
              {!!item.skill_overlaps?.length && <p>Shared mentions: {item.skill_overlaps.map(skill => skill.label + (skill.kind === 'general' ? ' (general trait)' : '')).join(', ')}.</p>}
              <p>{item.reason}</p>
              <RequirementConditions item={item} />
              <details>
                <summary>Compare evidence</summary>
                <dl>
                  <dt>Job description quote</dt><dd>{item.job_evidence}</dd>
                  <dt>Your profile{item.profile_field ? ' · ' + item.profile_field : ''}</dt>
                  <dd>{item.profile_evidence || 'No comparable explicit evidence used. Review your education, experience and skills manually.'}</dd>
                </dl>
              </details>
            </li>)}
          </ul> : <p>{group.empty}</p>}
        </div>)}
        <WorkConstraints items={result.work_constraints} />
      </>}
    </>}
  </section>
}
