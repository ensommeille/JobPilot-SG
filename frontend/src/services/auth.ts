import axios from 'axios'

const BASE = 'http://localhost:8000'

export const saveToken = (token: string) =>
  localStorage.setItem('jobpilot_token', token)

export const getToken = () =>
  localStorage.getItem('jobpilot_token')

export const removeToken = () =>
  localStorage.removeItem('jobpilot_token')

export const isLoggedIn = () => !!getToken()

// 真实登录 API
export const loginApi = async (email: string, password: string) => {
  const res = await axios.post(`${BASE}/auth/login`, { email, password })
  return res.data // { access_token, token_type, expires_in, user }
}

// 真实注册 API
export const registerApi = async (email: string, password: string) => {
  const res = await axios.post(`${BASE}/auth/register`, { email, password })
  return res.data
}