import api from './api'
import type { AxiosRequestConfig } from 'axios'

export type JobId = number | string

export const fetchJobs = (params?: {
  q?: string; tags?: string; city?: string
  type?: string; deadline_from?: string; deadline_to?: string
  page?: number; page_size?: number
}, config?: AxiosRequestConfig) => api.get('/jobs', { ...config, params: { ...config?.params, ...params } })

export const fetchJobById = (id: JobId, config?: AxiosRequestConfig) => api.get(`/jobs/${id}`, config)

export const addFavorite = (id: JobId, config?: AxiosRequestConfig) => api.post(`/jobs/${id}/favorite`, undefined, config)

export const removeFavorite = (id: JobId, config?: AxiosRequestConfig) => api.delete(`/jobs/${id}/favorite`, config)

export const fetchFavorites = (page = 1, pageSize = 20, config?: AxiosRequestConfig) =>
  api.get('/favorites', { ...config, params: { ...config?.params, page, page_size: pageSize } })

/* #17: job-object salary formatter (used by JobDetailPage on raw JobRead) */
export const formatSalary = (job: {
  salary_min: number | null; salary_max: number | null
  salary_currency: string | null; salary_period: string | null
}): string | null => {
  if (job.salary_min === null && job.salary_max === null) return null
  const amount = job.salary_min === null ? `${job.salary_max}`
    : job.salary_max === null ? `${job.salary_min}`
      : `${job.salary_min}–${job.salary_max}`
  return `${job.salary_currency ?? ''} ${amount}${job.salary_period ? ` / ${job.salary_period}` : ''}`.trim()
}

/* ------------------------------------------------------------------
 * 统一的岗位数据结构 (from #18)
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

const formatSalaryRange = (min: number | null, max: number | null, currency: string | null, period: string | null) => {
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
    location: str(raw.city) ?? str(raw.location) ?? 'Location unknown',
    type: str(raw.job_type) ?? str(raw.type) ?? 'Other',
    tags: ((raw.tags as RawTag[] | undefined) ?? [])
      .map(t => (typeof t === 'string' ? t : t?.name ?? ''))
      .filter(Boolean),
    salaryText: formatSalaryRange(min, max, str(raw.salary_currency), str(raw.salary_period)) ?? str(raw.salary),
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

// The API caps each response at 100 jobs. Load every page before applying the
// sidebar filters, otherwise a successful crawl silently hides later pages.
export const fetchAllJobs = async (q: string, signal?: AbortSignal): Promise<JobView[]> => {
  const jobs = new Map<JobId, JobView>()
  for (let page = 1; ; page += 1) {
    const response = await fetchJobs({ q: q || undefined, page, page_size: 100 }, { signal })
    for (const job of normalizeJobList(response.data)) jobs.set(job.id, job)
    const reportedPages = Number(response.data?.pages)
    if (!Number.isSafeInteger(reportedPages) || reportedPages < 0 || reportedPages > 1000) throw new Error('Invalid job page count')
    if (page >= reportedPages) break
  }
  return [...jobs.values()]
}

export const normalizeFavoriteList = (data: unknown): JobView[] => {
  const items = Array.isArray(data) ? data : (data as { items?: unknown[] })?.items ?? []
  return (items as { job: RawJob }[]).map(item => normalizeJob(item.job))
}
