import api from './api'

export const fetchProfile = () => api.get('/profile')

export const updateProfile = (data: object) => api.put('/profile', data)

export const uploadResume = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/profile/resumes', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}