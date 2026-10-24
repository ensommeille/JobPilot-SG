import api from './api'
import type { AxiosRequestConfig } from 'axios'

export const fetchProfile = (config?: AxiosRequestConfig) => api.get('/profile', config)

export const updateProfile = (data: object, config?: AxiosRequestConfig) => api.put('/profile', data, config)

export { uploadResumeFile as uploadResume } from './resumes'
