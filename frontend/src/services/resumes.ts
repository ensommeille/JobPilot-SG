import type { AxiosRequestConfig } from 'axios'
import api from './api'
import { getToken } from './auth'

export interface ResumeSuggestions {
  full_name?: string | null
  contact_email?: string | null
  phone?: string | null
  education?: string | null
  experience?: string | null
  skills?: string[]
}

export interface ResumeFile {
  id: string
  filename: string
  content_type: string
  size_bytes: number
  uploaded_at: string
  has_file: boolean
  sha256: string | null
  extraction_status: 'metadata_only' | 'parsed' | 'needs_text'
  page_count: number | null
}

export interface ResumeDetail extends ResumeFile {
  text: string
  suggestions: ResumeSuggestions
  notice: string
}

export const listResumes = (config?: AxiosRequestConfig) => api.get<ResumeFile[]>('/profile/resumes', config)
export const fetchResume = (id: string, config?: AxiosRequestConfig) => api.get<ResumeDetail>(`/profile/resumes/${id}`, config)
export const fetchResumeContent = (id: string, config?: AxiosRequestConfig) => api.get<Blob>(`/profile/resumes/${id}/content`, { ...config, responseType: 'blob' })
export const deleteResumeFile = (id: string, config?: AxiosRequestConfig) => api.delete(`/profile/resumes/${id}`, config)
export const uploadResumeFile = (file: File, config?: AxiosRequestConfig) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<ResumeFile>('/profile/resumes/upload', form, { ...config, headers: { ...config?.headers, 'Content-Type': 'multipart/form-data' } })
}

export async function downloadResumeFile(id: string, filename: string, token: string) {
  const result = await fetchResumeContent(id, { timeout: 15000, headers: { Authorization: `Bearer ${token}` } })
  if (getToken() !== token) throw new Error('Account changed. Open your resume again.')
  const url = URL.createObjectURL(result.data)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
