import api from './api'
import type { AxiosRequestConfig } from 'axios'

export const fetchProfile = (config?: AxiosRequestConfig) => api.get('/profile', config)

export const updateProfile = (data: object, config?: AxiosRequestConfig) => api.put('/profile', data, config)

export const uploadResume = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/profile/resumes', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}
