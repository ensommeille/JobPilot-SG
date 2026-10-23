import api from './api'
import type { ApplicationRequestConfig } from './applications'
import type { EmailOption } from './emailApplications'

export type ApplicationChannel = 'email' | 'internsg' | 'ats' | 'assistant' | 'external' | 'unavailable'
export type HistoryChannel = 'email' | 'manual' | 'assistant' | 'extension'

export interface ApplicationContext {
  job: { id: string; title: string; company: string; status: string; apply_url: string | null; source_url: string | null }
  profile: {
    full_name: string | null; contact_email: string | null; phone: string | null
    resume_summary: string | null; availability_period: string | null
    education: string | null; experience: string | null; skills: string[]
    nationality: string | null; study_country: string | null
  }
  channel: ApplicationChannel
  channel_label: string
  instructions: string[]
  preparation_url: string | null
  original_application_url: string | null
  email_option: EmailOption | null
}

export interface UnifiedApplicationRecord {
  id: string
  record_id: string
  kind: 'application' | 'email'
  job: { id: string; title: string; company: string }
  channel: HistoryChannel
  method: 'manual' | 'assistant' | 'extension' | null
  status: string
  display_status: string
  created_at: string
  updated_at: string
  submitted_at: string | null
  sent_at: string | null
  resume_filename: string | null
  next_action: string
  actual_recipient: string | null
  original_recipient: string | null
  receipt: { message_id?: string; [key: string]: unknown } | null
  failure_code: string | null
}

export interface ApplicationHistoryPage {
  items: UnifiedApplicationRecord[]
  total: number
  page: number
  page_size: number
  pages: number
}

export const fetchApplicationContext = (jobId: string, config?: ApplicationRequestConfig) =>
  api.get<ApplicationContext>(`/jobs/${jobId}/application-context`, config)

export const fetchApplicationHistory = (page: number, pageSize: number, channel: HistoryChannel | '', config?: ApplicationRequestConfig) =>
  api.get<ApplicationHistoryPage>('/application-history', { ...config, params: { page, page_size: pageSize, ...(channel ? { channel } : {}) } })

export const savePreparationDraft = (jobId: string, config?: ApplicationRequestConfig) =>
  api.post(`/jobs/${jobId}/applications`, { status: 'draft' }, config)
