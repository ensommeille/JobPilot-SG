import axios from 'axios'
import { getToken, removeToken } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
})

// Bind the credential synchronously; never replace an explicitly pinned session.
api.interceptors.request.use(config => {
  const token = getToken()
  if (token && !config.headers.has('Authorization')) config.headers.Authorization = `Bearer ${token}`
  return config
}, undefined, { synchronous: true })

// An old request's 401 must not sign out a newly selected account.
api.interceptors.response.use(
  res => res,
  err => {
    const current = getToken()
    if (err.response?.status === 401 && current && err.config?.headers?.Authorization === `Bearer ${current}`) {
      removeToken()
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

export default api
