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
  profile_field: 'skills' | 'education' | 'experience' | null
  profile_quote: string | null
  reason: string
}

export interface AIRecommendationRun {
  id: string
  status: 'running' | 'succeeded' | 'failed'
  reused: boolean
  input_hash: string
  provider: string
  model: string
  prompt_version: string
  execution_mode: 'live' | 'mock'
  profile_skill_count: number
  candidates: AICandidate[]
  result: {
    requires_review: true
    items: {
      job_id: string
      rank: number
      summary: string
      requirements: AIRequirement[]
      warnings: string[]
    }[]
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

export const startAIRecommendations = (jobIds: string[], config?: AxiosRequestConfig) =>
  api.post<AIRecommendationRun>('/jobs/ai-recommendations', {
    confirmed: true, job_ids: jobIds,
  }, config)

export const fetchAIRecommendationRun = (id: string, config?: AxiosRequestConfig) =>
  api.get<AIRecommendationRun>(`/ai-recommendations/${encodeURIComponent(id)}`, config)
