import type { AxiosRequestConfig } from 'axios'
import api from './api'

export interface PreparedAnswer {
  field_id: 'intro' | 'experience' | 'motivation'
  value: string
  source: 'saved' | 'ai_draft' | 'pending_confirmation'
  fact_key: string | null
  citations: { source: 'resume' | 'profile' | 'job'; source_id: string; quote: string }[]
}

export interface PreparedAnswers {
  status: 'ready' | 'partial' | 'preparing' | 'unavailable'
  profile_fingerprint: string
  resume_id: string | null
  preparation_id: string | null
  answers: PreparedAnswer[]
  omitted: { field_id: string; reason: string }[]
  reused: boolean
  execution_mode: 'not_needed' | 'live' | 'mock' | 'unavailable'
  elapsed_ms: number
  error_code: string | null
}

export const warmPreparedAnswers = (data: {
  job_id: string; profile_fingerprint: string; resume_id?: string; cache_only?: true
}, config?: AxiosRequestConfig) => api.post<PreparedAnswers>(
  '/browser-assistant/prepare-answers/warm', { confirmed: true, ...data }, { timeout: 8200, ...config },
)
