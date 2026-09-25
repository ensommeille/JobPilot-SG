import api from './api'

export const fetchJobs = (params?: {
  q?: string; tags?: string; city?: string
  type?: string; deadline_from?: string; deadline_to?: string
  page?: number; page_size?: number
}) => api.get('/jobs', { params })

export const fetchJobById = (id: number) => api.get(`/jobs/${id}`)

export const addFavorite = (id: number) => api.post(`/jobs/${id}/favorite`)

export const removeFavorite = (id: number) => api.delete(`/jobs/${id}/favorite`)

export const fetchFavorites = () => api.get('/favorites')