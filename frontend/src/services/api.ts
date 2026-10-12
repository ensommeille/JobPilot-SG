import axios from 'axios'
import { getToken } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' }
})

// 每次请求自动带上 Token
api.interceptors.request.use(config => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 401 自动跳回登录页
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('jobpilot_token')
      window.location.href = '/'
    }
    return Promise.reject(err)
  }
)

export default api