import api from './api'

export type JobId = number | string

export const fetchJobs = (params?: {
  q?: string; tags?: string; city?: string
  type?: string; deadline_from?: string; deadline_to?: string
  page?: number; page_size?: number
}) => api.get('/jobs', { params })

export const fetchJobById = (id: JobId) => api.get(`/jobs/${id}`)

export const addFavorite = (id: JobId) => api.post(`/jobs/${id}/favorite`)

export const removeFavorite = (id: JobId) => api.delete(`/jobs/${id}/favorite`)

export const fetchFavorites = () => api.get('/favorites')

/* ------------------------------------------------------------------
 * 统一的岗位数据结构
 * 后端 JobRead 返回 city / job_type / salary_min / tags:[{name}] / source:{name}，
 * 早期 mock 数据用的是 location / type / salary / tags:string[]。
 * normalizeJob 两种都接受，页面只依赖 JobView。
 * ------------------------------------------------------------------ */
export interface JobView {
  id: JobId
  title: string
  company: string
  location: string
  type: string
  tags: string[]
  salaryText: string | null
  salaryValue: number | null   // 用于排序：取月薪下限
  deadline: string | null      // YYYY-MM-DD
  postedAt: string | null
  source: string | null
}

type RawTag = string | { name?: string }
type RawJob = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const formatSalary = (min: number | null, max: number | null, currency: string | null, period: string | null) => {
  if (min == null && max == null) return null
  const cur = currency && currency.toUpperCase() !== 'SGD' ? `${currency} ` : 'S$'
  const fmt = (n: number) => n.toLocaleString('en-SG')
  const range = min != null && max != null && min !== max ? `${fmt(min)} – ${fmt(max)}` : fmt((min ?? max) as number)
  const per = period ? ` / ${period.replace(/^per\s+/i, '').replace(/^month(ly)?$/i, 'mo')}` : ''
  return `${cur}${range}${per}`
}

export const normalizeJob = (raw: RawJob): JobView => {
  const min = num(raw.salary_min)
  const max = num(raw.salary_max)
  const source = raw.source
  return {
    id: (raw.id as JobId) ?? '',
    title: str(raw.title) ?? 'Untitled role',
    company: str(raw.company) ?? 'Unknown company',
    location: str(raw.city) ?? str(raw.location) ?? 'Singapore',
    type: str(raw.job_type) ?? str(raw.type) ?? 'Other',
    tags: ((raw.tags as RawTag[] | undefined) ?? [])
      .map(t => (typeof t === 'string' ? t : t?.name ?? ''))
      .filter(Boolean),
    salaryText: formatSalary(min, max, str(raw.salary_currency), str(raw.salary_period)) ?? str(raw.salary),
    salaryValue: min ?? max,
    deadline: str(raw.deadline),
    postedAt: str(raw.posted_at),
    source: typeof source === 'object' && source ? str((source as { name?: unknown }).name) : str(source),
  }
}

export const normalizeJobList = (data: unknown): JobView[] => {
  const items = Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? []
  return (items as RawJob[]).map(normalizeJob)
}
