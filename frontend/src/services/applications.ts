import api from './api'
import type { AxiosRequestConfig } from 'axios'

export const fetchApplications = (page = 1, pageSize = 20, config?: Pick<AxiosRequestConfig, 'headers' | 'signal' | 'timeout'>) =>
  api.get('/applications', { ...config, params: { page, page_size: pageSize } })

export const submitApplication = (jobId: number, data: object) =>
  api.post(`/jobs/${jobId}/applications`, data)
