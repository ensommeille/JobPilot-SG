// Token 存取工具函数
export const saveToken = (token: string) => {
  localStorage.setItem('jobpilot_token', token)
}

export const getToken = () => {
  return localStorage.getItem('jobpilot_token')
}

export const removeToken = () => {
  localStorage.removeItem('jobpilot_token')
}

export const isLoggedIn = () => {
  return !!getToken()
}