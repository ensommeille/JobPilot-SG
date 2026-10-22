import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import api from '../services/api'
import { getToken, watchSession } from '../services/auth'
import { RequirementConditions, WorkConstraints } from './RequirementEvidence'
import type { StructuredRequirement, WorkConstraintEvidence } from './RequirementEvidence'
import { isGeneralTraitOnly } from './matchPresentation'
import ResponsibilityEvidence from './ResponsibilityEvidence'
import type { ResponsibilityMatch } from './ResponsibilityEvidence'
import SourceReviewNotice from './SourceReviewNotice'
import type { SourceReview } from './SourceReviewNotice'
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
  responsibility_matches?: ResponsibilityMatch[]
  source_review?: SourceReview | null
}
const reasons: Record<string, string> = {
  missing_extraction: 'Requirements are not ready yet. Check the job description below.',
  stale_extraction: 'This job has changed. Requirements need updating; check the latest job description.',
  invalid_source_review: 'The corrected requirements could not be verified. Check the original job description while the project owner reviews them.',
  invalid_extraction: 'Requirements could not be verified. Check the job description below.',
  extraction_running: 'Requirements are being prepared. Try again shortly.',
  extraction_failed: 'Requirements could not be prepared. Check the job description instead.',
  no_requirements: 'No requirements are available to compare. Check the job description; the role may still have requirements.',
}
const groups = [
  {key: 'matched', title: 'Matched skills', description: 'Named in both the job and your profile. Proficiency still needs checking.'},
  {key: 'gap', title: 'Explicit gaps', description: 'Your profile says you lack this skill or experience. Check that it is still accurate.'},
  {key: 'missing', title: 'Missing from profile', description: 'Not listed in your skills. Add it if you have it; missing does not mean you lack it.'},
  {key: 'review', title: 'Needs review', description: 'Not enough evidence to confirm a match or a gap.'},
] as const
type MatchGroup = typeof groups[number]['key']

function groupOf(item: MatchItem): MatchGroup {
  if (item.outcome === 'supported') return 'matched'
  if (item.outcome === 'gap') return 'gap'
  // The current API has no missing-profile reason code. Only this explicit
  // legacy reason establishes missing skill information; null evidence does not.
  // New reasons and compound requirements must fail closed to manual review.
  if (!item.skill_overlaps?.length && !item.conditions?.length
    && ['required_skills', 'preferred_skills'].includes(item.category)
    && !item.profile_evidence
    && item.reason === 'This skill is not explicitly listed. Missing information is not a proven gap.') return 'missing'
  return 'review'
}

function reviewHint(item: MatchItem): string {
  if (item.skill_overlaps?.length) return 'Shared skills alone do not confirm the full requirement.'
  if (item.reason === 'Your skill entries conflict; update your profile.') return 'Your skill entries conflict. Check your profile.'
  if (item.reason === 'Extraction evidence is not present in the current job description.'
    || item.reason === 'The quote does not explicitly name this skill.') return 'The source evidence is unclear. Check the full job description.'
  if (['education', 'experience', 'languages', 'required_qualifications', 'preferred_qualifications'].includes(item.category)) {
    return 'Skills alone cannot confirm this requirement. Check it against your experience.'
  }
  return 'Check this requirement against your experience. It may not be missing from your profile.'
}

function MatchRow({item, group}: {item: MatchItem; group: MatchGroup}) {
  const sharedSkills = [...new Set(item.skill_overlaps?.map(skill => skill.label) || [])]
  return <li className="job-match-item">
    <p className="job-match-requirement" lang="en"><strong>{item.requirement}</strong></p>
    {group === 'review' && <>
      {!!sharedSkills.length && <p className="job-match-shared">Shared skills: {sharedSkills.join(', ')}</p>}
      <p className="job-match-hint">{reviewHint(item)}</p>
    </>}
    <details className="job-match-evidence">
      <summary>View evidence</summary>
      <dl>
        <dt>Job description</dt><dd lang="en">{item.job_evidence}</dd>
        <dt>Your profile</dt><dd>{item.profile_evidence || 'No explicit profile evidence was used for this requirement.'}</dd>
      </dl>
      <p className="job-match-hint">{item.importance === 'unspecified' ? 'Priority not stated' : item.importance === 'required' ? 'Required — model-labelled, unverified' : 'Preferred — model-labelled, unverified'}</p>
      <p lang="en">{item.reason}</p>
      <div lang="en"><RequirementConditions item={item} /></div>
    </details>
  </li>
}

export default function JobMatchAnalysis({jobId}: {jobId: string}) {
  const [result, setResult] = useState<Analysis | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const unwatch = watchSession(() => {
        controller.current?.abort(); setResult(null); setBusy(false); setError('Account changed. Sign in and check again.')
    })
    return () => { controller.current?.abort(); unwatch() }
  }, [])

  async function analyze() {
    const token = getToken()
    if (!token) { setResult(null); setError('Sign in to JobPilot to check your match.'); return }
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true); setError(''); setResult(null)
    try {
      const response = await api.post<Analysis>(`/jobs/${jobId}/match-analysis`, {include_experience: true}, {signal: request.signal, timeout: 15000, headers: {Authorization: `Bearer ${token}`}})
      if (request.signal.aborted) return
      if (getToken() !== token) { setError('Account changed. Check your match again.'); return }
      setResult(response.data)
    } catch (err) {
      if (!request.signal.aborted) setError(axios.isAxiosError(err) && err.response?.status === 404
        ? 'This job is no longer available. Return to the job list.'
        : 'Could not check your match. Check your connection and try again.')
    } finally {
      if (controller.current === request) setBusy(false)
    }
  }

  const generalTraits = result?.items.filter(isGeneralTraitOnly) || []
  const focusedItems = result?.items.filter(item => !isGeneralTraitOnly(item)) || []
  const grouped = groups.map(group => ({...group, items: focusedItems.filter(item => groupOf(item) === group.key)}))
  const mock = result?.warnings.includes('Requirements come from a mock extraction; treat this as a demonstration.')

  return <section className="job-match" lang="en" aria-labelledby="job-match-title" aria-busy={busy}>
    <h3 id="job-match-title">Your skills &amp; this job</h3>
    <p className="job-match-hint">Compare job skills and duties with your saved skills and project experience. Not a hiring decision.</p>
    <div className="job-match-actions">
      <button className="btn btn-primary" disabled={busy} onClick={analyze}>{busy ? 'Checking…' : result ? 'Check again' : 'Check my match'}</button>
      <Link to="/profile">Edit profile</Link>
    </div>
    {busy && <p role="status">Comparing your saved skills and project experience with this job…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <>
      <SourceReviewNotice review={result.source_review} />
      {mock && <p className="job-match-notice" role="status">Demo data: these results use mock requirements, not a real job assessment.</p>}
      {result.status === 'unavailable' && <p className="job-match-notice" role="status">
        {reasons[result.reason || ''] || 'Requirements are unavailable. Check the job description instead.'}
      </p>}
      {result.status === 'preliminary' && <>
        {focusedItems.length > 0 ? <>
        <p className="job-match-hint" role="status">{focusedItems.length} requirements in focus. Check again after editing your profile.</p>
        <dl className="job-match-counts" aria-label="Match overview">
          {grouped.map(group => <div key={group.key} data-match-count={group.key}>
            <dt>{group.title}</dt><dd>{group.items.length}</dd>
          </div>)}
        </dl>
        {!grouped[0].items.length && <p className="job-match-hint">No confirmed skill matches yet. You can still apply.</p>}
        </> : <p className="job-match-hint" role="status">No specific skills were identified for comparison. {result.responsibility_matches?.length ? 'The responsibility comparison is shown below.' : 'Check the job description.'}</p>}
        <ResponsibilityEvidence items={result.responsibility_matches} />
        {grouped.filter(group => group.items.length > 0).map(group => <section className="job-match-group" data-match-group={group.key} key={group.key} aria-labelledby={`job-match-${group.key}`}>
          <h4 id={`job-match-${group.key}`}>{group.title}<span className="job-match-group-count">{group.items.length}</span></h4>
          <p className="job-match-hint">{group.description}</p>
          {group.key === 'missing' && <Link to="/profile">Add my skills</Link>}
          <ul>{group.items.map((item, index) => <MatchRow key={index} item={item} group={group.key} />)}</ul>
        </section>)}
        <div className="job-match-more">
        {generalTraits.length > 0 && <details className="job-match-general">
          <summary>General traits ({generalTraits.length})</summary>
          <p className="job-match-hint">Kept for reference, not counted as skill matches or profile gaps.</p>
          <ul>{generalTraits.map((item, index) => <li className="job-match-general-item" key={index}>
            <p><strong>{item.requirement}</strong></p>
            <details>
              <summary>View source</summary>
              <blockquote>{item.job_evidence}</blockquote>
              <p className="job-match-hint">{item.importance === 'unspecified' ? 'Priority not stated' : item.importance === 'required' ? 'Required — model-labelled, unverified' : 'Preferred — model-labelled, unverified'}</p>
            </details>
          </li>)}</ul>
        </details>}
        {!!result.work_constraints?.length && <details>
          <summary>Work conditions to review</summary>
          <p className="job-match-hint">These have not been checked against your availability or location.</p>
          <div lang="en"><WorkConstraints items={result.work_constraints} /></div>
        </details>}
        {(result.summary || !!result.responsibilities?.length) && <details>
          <summary>Role &amp; responsibilities</summary>
          <div lang="en">
          {result.summary && <><p>{result.summary.value}</p><details><summary>Role summary evidence</summary><blockquote>{result.summary.evidence}</blockquote></details></>}
          <ul>{result.responsibilities?.map((duty, index) => <li key={index}>
            <p><strong>{duty.priority === 'unspecified' ? 'Priority not stated' : duty.priority === 'conditional' ? 'Conditional responsibility' : duty.priority === 'primary' ? 'Primary responsibility' : 'Secondary responsibility'}:</strong> {duty.value}</p>
            {duty.condition && <p>Applies when: {duty.condition.value}</p>}
            <details><summary>Responsibility evidence</summary><blockquote>{duty.evidence}</blockquote>
              {duty.condition && <blockquote>{duty.condition.evidence}</blockquote>}</details>
          </li>)}</ul></div>
        </details>}
        <details className="job-match-limits">
          <summary>About this analysis</summary>
          <p>This comparison uses your saved skills and experience text; uploaded resume files are not read. Project evidence shows related activities, not verified expertise. Check education, proficiency and work arrangements yourself.</p>
          <p>Requirements are model-extracted and not human-verified. Counts refer to requirements, not a match percentage. “Needs review” does not necessarily mean your profile is incomplete.</p>
          {result.warnings.map(warning => <p lang="en" key={warning}>{warning}</p>)}
        </details>
        </div>
      </>}
    </>}
  </section>
}
