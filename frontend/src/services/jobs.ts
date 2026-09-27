import api from './api'

export const fetchJobs = (params?: {
  q?: string; tags?: string; city?: string
  type?: string; deadline_from?: string; deadline_to?: string
  page?: number; page_size?: number
}) => api.get('/jobs', { params })

export const fetchJobById = (id: string) => api.get(`/jobs/${id}`)

export const addFavorite = (id: string | number) => api.post(`/jobs/${id}/favorite`)

export const removeFavorite = (id: string | number) => api.delete(`/jobs/${id}/favorite`)

export const fetchFavorites = () => api.get('/favorites')

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
