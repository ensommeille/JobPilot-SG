import axios from 'axios'
import { notifyExtensionSignedOut } from './extensionConnection'

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export const saveToken = async (token: string) => {
  const previous = getToken()
  if (previous && previous !== token) {
    await revokeSession(previous)
    if (getToken() !== previous) throw new Error('Account changed while signing in. Please sign in again.')
    removeToken()
  }
  localStorage.setItem('jobpilot_token', token)
  window.dispatchEvent(new Event('jobpilot-auth-changed'))
}

export const getToken = () =>
  localStorage.getItem('jobpilot_token')

export const removeToken = () => {
  localStorage.removeItem('jobpilot_token')
  notifyExtensionSignedOut()
  window.dispatchEvent(new Event('jobpilot-auth-changed'))
}

const revokeSession = async (token: string) => {
    try { await axios.post(`${BASE}/auth/logout`, {}, {headers: {Authorization: `Bearer ${token}`}, timeout: 15000}) }
    catch (error) {
      if (!axios.isAxiosError(error) || error.response?.status !== 401) throw new Error('Could not revoke the session. Stay signed in and retry logout when online.', { cause: error })
    }
}

export const logoutPlatform = async () => {
  const token = getToken()
  if (token) await revokeSession(token)
  if (getToken() === token) removeToken()
}

export const watchSession = (changed: () => void) => {
  let previous = getToken()
  const check = () => {
    const current = getToken()
    if (current !== previous) { previous = current; changed() }
  }
  const storage = (event: StorageEvent) => {
    if (event.key === 'jobpilot_token' || event.key === null) check()
  }
  window.addEventListener('storage', storage)
  window.addEventListener('jobpilot-auth-changed', check)
  window.addEventListener('focus', check)
  return () => {
    window.removeEventListener('storage', storage)
    window.removeEventListener('jobpilot-auth-changed', check)
    window.removeEventListener('focus', check)
  }
}

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
