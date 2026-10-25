import type { ApplicationRecommendation, JobActionAdvice } from './aiRecommendations'

export const applicationVerdictLabels: Record<ApplicationRecommendation['verdict'], string> = {
  priority_apply: 'Prioritize applying',
  consider: 'Worth considering',
  not_priority: 'Not a priority',
  insufficient_information: 'More information needed',
}

export function applicationRecommendation(advice: JobActionAdvice | null): ApplicationRecommendation | null {
  const recommendation = advice?.application_recommendation
  if (!recommendation || !Object.hasOwn(applicationVerdictLabels, recommendation.verdict) || !recommendation.summary.trim()) return null
  const points = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 3)
  const summary = recommendation.summary.trim()
  const label = applicationVerdictLabels[recommendation.verdict].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutRepeatedLabel = summary.replace(new RegExp(`^${label}[.!?。！？]+\\s*`, 'i'), '').trim()
  return {
    verdict: recommendation.verdict,
    summary: withoutRepeatedLabel || summary,
    strengths: points(recommendation.strengths),
    considerations: points(recommendation.considerations),
  }
}
