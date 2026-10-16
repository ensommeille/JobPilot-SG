import api from './api'
import type { AxiosRequestConfig } from 'axios'

export type ApplicationStatus = 'draft' | 'submitted' | 'interviewing' | 'offered' | 'rejected' | 'withdrawn'
export type ApplicationMethod = 'manual' | 'assistant' | 'extension'
export type ApplicationRequestConfig = Pick<AxiosRequestConfig, 'headers' | 'signal' | 'timeout'>

export interface ApplicationRecord {
  id: string
  job: { id: string; title: string; company: string }
  method: ApplicationMethod
  status: ApplicationStatus
  submitted_at: string | null
  created_at: string
  updated_at: string
}

export interface ApplicationPage {
  items: ApplicationRecord[]
  page: number
  page_size: number
  total: number
  pages: number
}

export const fetchApplications = (page = 1, pageSize = 20, config?: ApplicationRequestConfig) =>
  api.get<ApplicationPage>('/applications', { ...config, params: { page, page_size: pageSize } })

export const fetchApplication = (applicationId: string, config?: ApplicationRequestConfig) =>
  api.get<ApplicationRecord>(`/applications/${applicationId}`, config)

export const createManualApplication = (jobId: string, config?: ApplicationRequestConfig) =>
  api.post<ApplicationRecord>(`/jobs/${jobId}/applications`, { status: 'submitted' }, config)

export const updateApplicationStatus = (applicationId: string, status: ApplicationStatus, config?: ApplicationRequestConfig) =>
  api.patch<ApplicationRecord>(`/applications/${applicationId}`, { status }, config)

export const findApplicationForJob = async (jobId: string, config?: ApplicationRequestConfig): Promise<ApplicationRecord | null> => {
  let page = 1
  while (true) {
    const response = await fetchApplications(page, 100, config)
    const existing = response.data.items.find(item => item.job.id === jobId)
    if (existing) return existing
    if (page >= response.data.pages) return null
    page += 1
  }
}
