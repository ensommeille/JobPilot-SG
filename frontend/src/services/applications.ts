import api from './api'

export const fetchApplications = (page = 1, pageSize = 20) =>
  api.get('/applications', { params: { page, page_size: pageSize } })

export const submitApplication = (jobId: number, data: object) =>
  api.post(`/jobs/${jobId}/applications`, data)
