import type { AIJobAssessment, JobActionAdvice } from '../services/aiRecommendations'
import { applicationRecommendation, applicationVerdictLabels } from '../services/jobFit'
import './JobAdvice.css'

export default function JobAdvice({ advice, historical = false }: { assessment: AIJobAssessment; advice: JobActionAdvice | null; historical?: boolean }) {
  if (historical) return null
  const recommendation = applicationRecommendation(advice)
  if (!recommendation) return <p className="job-advice-pending" role="status">The latest application recommendation is not ready yet.</p>
  return <div className="job-advice" data-advice-status={recommendation.verdict}>
    <h4 className={`job-advice-status job-advice-${recommendation.verdict}`}>{applicationVerdictLabels[recommendation.verdict]}</h4>
    <p className="job-advice-summary">{recommendation.summary}</p>
    <div className="job-advice-groups">
      {!!recommendation.strengths.length && <section className="job-advice-strengths" aria-label="Strengths">
        <h5>Strengths</h5>
        <ul>{recommendation.strengths.map(point => <li key={point}>{point}</li>)}</ul>
      </section>}
      {!!recommendation.considerations.length && <section className="job-advice-considerations" aria-label="Things to consider">
        <h5>Things to consider</h5>
        <ul>{recommendation.considerations.map(point => <li key={point}>{point}</li>)}</ul>
      </section>}
    </div>
  </div>
}
