import api from './api'
import { extensionMessage } from './extensionConnection'

export type ExtensionStatus = 'connected' | 'not_connected' | 'wrong_account' | 'wrong_environment' | 'browser_unavailable'

// This is a read-only metadata probe. It never requests a profile, inspects a form,
// grants permissions or fills fields. A remembered extension ID proves nothing.
export async function checkExtensionStatus(token: string, signal?: AbortSignal): Promise<ExtensionStatus> {
  const id = localStorage.getItem('jobpilot_extension_id')
  if (!id || !/^[a-p]{32}$/.test(id)) return 'not_connected'
  const browser = window as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } }
  if (!browser.chrome?.runtime?.sendMessage) return 'browser_unavailable'
  const status = await extensionMessage(id, { kind: 'connection-status', version: 1 })
  if (signal?.aborted) return 'not_connected'
  if (status.version !== 1 || typeof status.connected !== 'boolean') return 'not_connected'
  if (!api.defaults.baseURL) return 'wrong_environment'
  const apiOrigin = new URL(api.defaults.baseURL, window.location.origin).origin
  if (status.platform_origin !== window.location.origin || status.api_origin !== apiOrigin) return 'wrong_environment'
  if (!status.connected) return 'not_connected'
  if (typeof status.user_id !== 'string' || typeof status.expires_at !== 'number' || !Number.isFinite(status.expires_at) || status.expires_at <= Date.now() / 1000) return 'not_connected'
  const current = await api.get<{ id: string }>('/users/me', { signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } })
  return current.data.id === status.user_id ? 'connected' : 'wrong_account'
}
