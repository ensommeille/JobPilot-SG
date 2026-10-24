import type { AIJobAssessment, JobActionAdvice } from '../services/aiRecommendations'
import './JobAdvice.css'

const adviceLabels = {
  priority_apply: 'Prioritize applying', consider: 'Worth considering',
  check_first: 'Check conditions first', not_priority: 'Lower priority',
}
const outcomeLabels = { supported: 'Supported', gap: 'Gap', unknown: 'Unknown' }
const fieldLabels = { skills: 'Saved skills', education: 'Saved education', experience: 'Saved experience', availability: 'Saved availability' }
const categoryLabels = {
  skill: 'Skill', responsibility: 'Responsibility', education: 'Education',
  experience: 'Experience', work_constraint: 'Work condition', other: 'Other requirement',
}
const categoryOrder = { work_constraint: 0, education: 1, experience: 2, skill: 3, responsibility: 4, other: 5 }

export default function JobAdvice({ assessment, advice, historical = false }: { assessment: AIJobAssessment; advice: JobActionAdvice | null; historical?: boolean }) {
  const requirements = [...assessment.requirements].sort((a, b) => categoryOrder[a.category] - categoryOrder[b.category])
  const reasons = advice?.reasons.length ? advice.reasons.slice(0, 2) : advice?.blockers.slice(0, 2).map(item => item.requirement) ?? []
  const label = advice ? adviceLabels[advice.status] : 'Review needed'
  const headline = advice?.headline || 'Review the saved evidence before deciding whether to apply.'
  const sameLabel = headline.trim().replace(/[.!。！]+$/, '').toLowerCase() === label.toLowerCase()
  return <div className="job-advice" data-advice-status={historical ? 'historical' : advice?.status ?? 'review_needed'}>
    {!historical && <>
    <div className="job-advice-decision"><h4 className={`job-advice-headline${sameLabel ? ` job-advice-${advice?.status ?? 'review_needed'}` : ''}`}>{headline}</h4>{!sameLabel && <span className={`job-advice-status job-advice-${advice?.status ?? 'review_needed'}`}>{label}</span>}</div>
    {!!reasons.length && <ul className="job-advice-reasons" aria-label="Main reasons">{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
    </>}
    <details className="job-advice-evidence"><summary>{historical ? 'Review historical evidence' : `Review ${requirements.length} ${requirements.length === 1 ? 'requirement' : 'requirements'} and source quotes`}</summary>
      {historical && <p className="job-advice-note">Snapshot only. These quotes and assessments may no longer reflect your saved profile or the current job.</p>}
      {!historical && <p className="job-advice-note">Original AI assessments may still be uncertain. Application advice applies extra conservative evidence checks.</p>}
      <ul className="job-advice-requirements">{requirements.map((requirement, index) => <li key={index}>
        <div className="job-advice-requirement-heading"><h5>{requirement.requirement}</h5><strong className={`job-advice-outcome job-advice-outcome-${requirement.outcome}`}>{outcomeLabels[requirement.outcome]}</strong></div>
        <p className="muted">{categoryLabels[requirement.category]} · Evidence assessment</p>
        <p>{requirement.reason}</p>
        <dl className="job-advice-quotes"><div><dt>Job description quote</dt><dd>{requirement.jd_quote}</dd></div><div><dt>{requirement.profile_field ? fieldLabels[requirement.profile_field] : 'Saved profile evidence'}</dt><dd>{requirement.profile_quote || 'No explicit saved evidence cited. More information or manual review is needed.'}</dd></div></dl>
      </li>)}</ul>
      {!!assessment.warnings.length && <ul className="job-advice-notes">{assessment.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      {!historical && <p className="job-advice-note">AI advice based on saved information. This does not verify proficiency or employer eligibility.</p>}
    </details>
  </div>
}
