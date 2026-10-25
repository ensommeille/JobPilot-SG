import type { AxiosRequestConfig } from 'axios'
import api from './api'

export interface AICandidate {
  id: string
  title: string
  company: string
  city: string | null
  job_type: string | null
}

export interface AICandidatePreview {
  candidates: AICandidate[]
  profile_ready: boolean
  scanned: number
  truncated: boolean
}

export interface AIRequirement {
  requirement: string
  category: 'skill' | 'responsibility' | 'education' | 'experience' | 'work_constraint' | 'other'
  outcome: 'supported' | 'gap' | 'unknown'
  jd_quote: string
  profile_field: 'skills' | 'education' | 'experience' | 'availability' | null
  profile_quote: string | null
  reason: string
  condition_checks?: AIConditionEvidence[]
  condition_operator?: 'atomic' | 'all_of' | 'any_of' | 'unspecified' | null
}

export interface AIConditionEvidence {
  condition: string
  outcome: AIRequirement['outcome']
  profile_field: AIRequirement['profile_field']
  profile_quote: string | null
  reason: string
}

export interface AIRelatedEvidence {
  requirement_index: number
  condition_index: number | null
  kind: 'partial_condition' | 'related_activity'
  statement: string
  jd_quote: string
  profile_field: Exclude<AIRequirement['profile_field'], null>
  profile_quote: string
  reason: string
}

export interface AIJobAssessment {
  job_id: string
  rank: number
  summary: string
  requirements: AIRequirement[]
  warnings: string[]
  related_evidence?: AIRelatedEvidence[]
}

export interface AdviceEvidence extends AIRequirement { requirement_index: number }

export interface ApplicationRecommendation {
  verdict: 'priority_apply' | 'consider' | 'not_priority' | 'insufficient_information'
  summary: string
  strengths: string[]
  considerations: string[]
}

export interface JobActionAdvice {
  version: 'action-advice-v1' | 'action-advice-v2' | 'action-advice-v3' | 'action-advice-v4' | 'action-advice-v5'
  status: 'priority_apply' | 'consider' | 'check_first' | 'not_priority'
  headline: string
  reasons: string[]
  blockers: AdviceEvidence[]
  strengths: AdviceEvidence[]
  counts: { supported: number; gap: number; unknown: number }
  related_evidence?: AIRelatedEvidence[]
  application_recommendation?: ApplicationRecommendation | null
}

export interface SavedJobAIAssessment {
  job_id: string
  context_hash?: string | null
  status: 'available' | 'not_analyzed' | 'outdated' | 'running' | 'failed' | 'unavailable'
  source_run_id: string | null
  assessment: AIJobAssessment | null
  advice: JobActionAdvice | null
  execution_mode: 'live' | 'mock' | null
  model: string | null
  finished_at: string | null
  reason: string | null
}

export interface AIRecommendationRun {
  id: string
  status: 'running' | 'succeeded' | 'failed'
  is_current?: boolean
  reused: boolean
  input_hash: string
  provider: string
  model: string
  prompt_version: string
  execution_mode: 'live' | 'mock'
  profile_skill_count: number
  candidates: AICandidate[]
  advice?: Record<string, JobActionAdvice>
  display_order?: string[]
  result: {
    requires_review: true
    items: AIJobAssessment[]
  } | null
  error_code: string | null
  usage: { input_tokens: number | null; output_tokens: number | null }
  started_at: string
  expires_at: string
  finished_at: string | null
}

export interface AICandidateFilters {
  keyword: string
  city: string
  job_type: string
}

export const fetchAICandidates = (filters: AICandidateFilters, config?: AxiosRequestConfig) =>
  api.get<AICandidatePreview>('/jobs/ai-recommendations/candidates', {
    ...config, params: { ...filters, limit: 20 },
  })

export const startAIRecommendations = (jobIds?: string[], config?: AxiosRequestConfig) =>
  api.post<AIRecommendationRun>('/jobs/ai-recommendations', {
    confirmed: true, ...(jobIds ? { job_ids: jobIds } : {}),
  }, config)

export const fetchAIRecommendationRun = (id: string, config?: AxiosRequestConfig) =>
  api.get<AIRecommendationRun>(`/ai-recommendations/${encodeURIComponent(id)}`, config)

export const fetchSavedJobAIAssessment = (id: string, config?: AxiosRequestConfig) =>
  api.get<SavedJobAIAssessment>(`/jobs/${encodeURIComponent(id)}/ai-assessment`, config)
