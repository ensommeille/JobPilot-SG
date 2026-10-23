import api from './api'

export interface JobSourceRead {
  id: string
  name: string
  source_type: string
  base_url: string
  schedule: string | null
  enabled: boolean
  status: string
}

export interface CrawlRunRead {
  id: string
  source_id: string
  status: string
  trigger: string
  items_found: number
  items_new: number
  items_updated: number
  items_failed: number
  created_at: string
  error_summary: Array<{ stage?: string; error_type?: string }>
}

export interface AuditEventRead {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  created_at: string
}

export interface AdminPageResult<T> {
  items: T[]
  page: number
  page_size: number
  total: number
  pages: number
}

export const fetchAdminIdentity = (signal: AbortSignal, token: string) =>
  api.get<{role: string}>('/users/me', {
    signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000,
  })

export const fetchAdminOverview = (
  signal: AbortSignal, token: string, runPage: number, auditPage: number,
) => Promise.all([
  api.get<JobSourceRead[]>('/sources', {
    signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000,
  }),
  api.get<AdminPageResult<CrawlRunRead>>('/runs', {
    params: {page: runPage, page_size: 20},
    signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000,
  }),
  api.get<AdminPageResult<AuditEventRead>>('/audit-events', {
    params: {page: auditPage, page_size: 20},
    signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000,
  }),
])
