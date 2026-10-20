import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { getToken, watchSession } from '../services/auth'
import { RequirementConditions, WorkConstraints } from './RequirementEvidence'
import type { StructuredRequirement, WorkConstraintEvidence } from './RequirementEvidence'
import ResponsibilityEvidence from './ResponsibilityEvidence'
import type { ResponsibilityMatch } from './ResponsibilityEvidence'
import './JobRecommendations.css'

interface Evidence extends StructuredRequirement {
  requirement: string
  importance: string
  reason: string
  job_evidence: string
  profile_evidence: string | null
  skill_overlaps?: {skill_id: string; label: string; kind: 'specific' | 'general'; profile_evidence: string}[]
}
interface Suggestion {
  job_id: string
  title: string
  company: string
  city: string | null
  job_type: string | null
  supported: Evidence[]
  gaps: Evidence[]
  unknown: Evidence[]
  overlaps?: Evidence[]
  work_constraints?: WorkConstraintEvidence[]
  responsibility_matches?: ResponsibilityMatch[]
}
interface UnreviewedJob {
  job_id: string
  title: string
  company: string
  city: string | null
  job_type: string | null
  mentioned_skills: string[]
}
interface Report {
  status: 'ready' | 'profile_needed' | 'no_candidates' | 'no_evidence' | 'no_matches'
  scanned: number
  evaluated: number
  truncated: boolean
  matched: number
  profile_skill_count: number
  preferred_job_type: 'internship' | null
  excluded: Record<string, number>
  items: Suggestion[]
  unreviewed_items: UnreviewedJob[]
}
const messages = {
  profile_needed: 'Add specific skills or describe work you have done in your saved experience. General traits and learning goals alone do not generate suggestions; uploaded resume files are not read.',
  no_candidates: 'No active, unexpired jobs fit these filters. Clear a filter or browse all jobs below.',
  no_evidence: 'Jobs were found, but none has a current real requirements extraction for reliable comparison. Refreshing or uploading a resume will not create one. This is not a rejection; a project administrator must run the extraction workflow before evidence-based suggestions can appear.',
  no_matches: 'No clear skill or project-activity overlaps were found in the jobs evaluated. Recognition is limited to named skills and described work, not every possible meaning. This is not a rejection: review your saved profile or browse all jobs.',
  ready: 'Suggestions to investigate — not an assessment of eligibility.',
}

function sharedSkills(job: Suggestion): string[] {
  const labels = [...job.supported, ...(job.overlaps || [])].flatMap(item =>
    item.skill_overlaps
      ? item.skill_overlaps.filter(skill => skill.kind === 'specific').map(skill => skill.label)
      : [item.requirement])
  return Array.from(new Set(labels))
}
const exclusions: Record<string, string> = {
  missing_extraction: 'Requirements not extracted', stale_extraction: 'Requirements out of date',
  invalid_extraction: 'Requirements could not be verified', extraction_running: 'Extraction in progress',
  extraction_failed: 'Extraction failed', no_requirements: 'No comparable requirements',
  mock_extraction: 'Mock data excluded',
}

export default function JobRecommendations() {
  const [filters, setFilters] = useState({keyword: '', city: '', job_type: ''})
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const unwatch = watchSession(() => {
        controller.current?.abort(); setReport(null); setBusy(false)
        setError('Account changed. Sign in and find jobs again.')
    })
    return () => { controller.current?.abort(); unwatch() }
  }, [])

  function changeFilter(key: keyof typeof filters, value: string) {
    controller.current?.abort(); setBusy(false); setReport(null); setError('')
    setFilters(previous => ({...previous, [key]: value}))
  }

  async function findJobs(event: React.FormEvent) {
    event.preventDefault()
    const token = getToken()
    if (!token) { setReport(null); setError('Sign in to JobPilot to get suggestions from your profile.'); return }
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setBusy(true); setReport(null); setError('')
    try {
      const response = await api.post<Report>('/jobs/recommendations', {...filters, limit: 10, include_experience: true},
        {signal: request.signal, timeout: 15000, headers: {Authorization: `Bearer ${token}`}})
      if (request.signal.aborted) return
      if (getToken() !== token) { setError('Account changed. Find jobs again.'); return }
      setReport(response.data)
    } catch {
      if (!request.signal.aborted) setError('Could not load suggestions. Check your connection and try again.')
    } finally {
      if (controller.current === request) setBusy(false)
    }
  }

  return <section className="job-recommendations" aria-labelledby="recommendations-title" aria-busy={busy}>
    <h2 id="recommendations-title">For you</h2>
    <p>Find jobs with tools, domain skills or activities related to your saved profile and real job descriptions. Shared terms are a reason to investigate, not proof that you meet every requirement. Skill evidence comes from your saved Skills list, not an uploaded resume file.</p>
    <form onSubmit={findJobs}>
      <div className="recommendation-filters">
        <label>Role or company (optional)<input className="input" maxLength={200} value={filters.keyword} onChange={e => changeFilter('keyword', e.target.value)} /></label>
        <label>City, exact name (optional)<input className="input" maxLength={120} placeholder="Singapore" value={filters.city} onChange={e => changeFilter('city', e.target.value)} /></label>
        <label>Job type, exact name (optional)<input className="input" maxLength={80} placeholder="internship" value={filters.job_type} onChange={e => changeFilter('job_type', e.target.value)} /></label>
      </div>
      <div className="recommendation-actions">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Finding jobs…' : 'Find jobs for me'}</button>
        <Link to="/profile">Update my profile</Link>
      </div>
    </form>
    <p className="muted">These filters apply only to For you and are not saved. After editing your profile, find jobs again.</p>
    {busy && <p role="status">Comparing your saved skills and project experience with current jobs…</p>}
    {error && <p role="alert">{error}</p>}
    {report && <div>
      <p role="status"><strong>{messages[report.status]}</strong></p>
      <p className="muted">Using {report.profile_skill_count} distinct named tool or domain {report.profile_skill_count === 1 ? 'skill' : 'skills'} from your saved Skills list. Resume files are not parsed.</p>
      {report.preferred_job_type === 'internship' && <p className="muted">Your saved introduction or availability explicitly mentions seeking an internship. Internship jobs appear before other job types when the skill-gap evidence is otherwise comparable; other jobs remain visible.</p>}
      {report.status !== 'profile_needed' && <>
        <p>{report.evaluated} of {report.scanned} candidate jobs evaluated. {report.matched} with related evidence; showing {report.items.length}.</p>
        {report.truncated && <p>Only the newest 500 candidates were scanned. Narrow your filters to explore others.</p>}
        {Object.keys(report.excluded).length > 0 && <details>
          <summary>Why some jobs were not evaluated</summary>
          <ul>{Object.entries(report.excluded).map(([reason, count]) => <li key={reason}>{exclusions[reason] || 'Requirements unavailable'}: {count}</li>)}</ul>
        </details>}
      </>}
      {report.status === 'ready' && <>
        <p className="recommendation-caveat">Preliminary: extraction is not human-verified. Skills and project activities are shown separately.</p>
        <details><summary>How suggestions are ordered</summary><p>No explicit gaps first, then an explicitly stated internship preference if present, more distinct exact named-skill entries, more distinct concrete skill overlaps, then related project activities, then newest postings. Exact entries do not verify proficiency or complete requirements. Generic traits and model-assigned priorities do not improve rank. Years, alternatives, education and other conditions still need review.</p></details>
        <ol className="recommendation-list">
          {report.items.map(job => <li key={job.job_id}>
            <h3><Link to={'/jobs/' + job.job_id}>{job.title}</Link></h3>
            <p className="muted">{job.company} · {job.city || 'City unspecified'} · {job.job_type || 'Type unspecified'}</p>
            {!!sharedSkills(job).length && <p><strong>Shared skills:</strong> {sharedSkills(job).join(', ')} named in both the JD and your saved skills.</p>}
            {job.responsibility_matches?.some(item => item.outcome === 'related_evidence') && <p><strong>Why shown:</strong> Your saved project experience includes related activities.</p>}
            <p>{job.gaps.length} explicit gaps · {job.unknown.length} requirements still need more information or manual review.</p>
            <ResponsibilityEvidence items={job.responsibility_matches?.filter(item => item.outcome === 'related_evidence')} showUnknown={false} />
            <details>
              <summary>Review reasons and evidence</summary>
              {([['Exact skill entry', job.supported], ['Skill overlap — conditions unverified', job.overlaps || []], ['Explicit gap', job.gaps], ['Unknown', job.unknown.filter(i => !job.overlaps?.length || !i.skill_overlaps?.length)]] as const).map(([label, items]) =>
                items.map((item, index) => <div className="recommendation-evidence" key={label + index}>
                  <h4>{label}: {item.requirement}</h4>
                  <p className="muted">Model-labelled priority: {item.importance} · not verified or used for ordering.</p>
                  {!!item.skill_overlaps?.length && <p>Shared mentions: {item.skill_overlaps.map(skill => skill.label + (skill.kind === 'general' ? ' (general trait; not ranked)' : '')).join(', ')}.</p>}
                  <p>{item.reason}</p>
                  <RequirementConditions item={item} />
                  <dl><dt>Job description</dt><dd>{item.job_evidence}</dd>
                    <dt>Your profile</dt><dd>{item.profile_evidence || 'No comparable explicit evidence used.'}</dd></dl>
                </div>))}
              <WorkConstraints items={job.work_constraints} />
              <ResponsibilityEvidence items={job.responsibility_matches?.filter(item => item.outcome === 'unknown')} showRelated={false} />
            </details>
            <Link to={'/jobs/' + job.job_id}>View job and full analysis</Link>
          </li>)}
        </ol>
      </>}
      {!!report.unreviewed_items?.length && <section aria-label="Unreviewed jobs to inspect">
        <h3>Unreviewed jobs to inspect</h3>
        <p className="recommendation-caveat">These public job descriptions mention skills in your saved profile, but their requirements have not been extracted or checked. New crawled jobs do not automatically become evaluated jobs: an administrator must prepare their requirements first. This is keyword discovery, not a match, score, recommendation, or eligibility decision. Internships appear first by default; use the job type filter for other roles. Open each job and verify the original posting.</p>
        <ol className="recommendation-list">{report.unreviewed_items.map(job => <li key={job.job_id}>
          <h3><Link to={'/jobs/' + job.job_id}>{job.title}</Link></h3>
          <p className="muted">{job.company} · {job.city || 'City unspecified'} · {job.job_type || 'Type unspecified'}</p>
          <p>Terms mentioned in the job description and your saved Skills list: {job.mentioned_skills.join(', ')}. Their context and importance have not been verified.</p>
          <Link to={'/jobs/' + job.job_id}>Review job and original source</Link>
        </li>)}</ol>
      </section>}
    </div>}
  </section>
}
