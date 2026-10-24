import { useEffect, useState } from 'react'
import { getToken } from '../services/auth'
import { checkExtensionStatus, type ExtensionStatus as Status } from '../services/extensionStatus'
import './ApplicationChannelInfo.css'

const labels: Record<Status, string> = {
  connected: 'Extension connected to this account. Each form still needs a separate field review.',
  not_connected: 'Extension not connected. Connect it in Chrome to use assisted filling, or complete the employer form manually.',
  wrong_account: 'The extension is connected to a different account. Reconnect it to this JobPilot account before assisted filling.',
  wrong_environment: 'The extension is connected to another JobPilot address. Reconnect it from this page.',
  browser_unavailable: 'Assisted filling requires Chrome with the JobPilot extension. You can still complete the employer form manually.',
}

export default function ExtensionStatus({ token, onConnectionChange }: { token: string | null; onConnectionChange?: (connected: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [checking, setChecking] = useState(Boolean(token))
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const request = new AbortController()
    if (!token) return () => request.abort()
    checkExtensionStatus(token, request.signal)
      .then(result => { if (!request.signal.aborted && getToken() === token) { setStatus(result); onConnectionChange?.(result === 'connected') } })
      .catch(() => { if (!request.signal.aborted && getToken() === token) { setStatus('not_connected'); onConnectionChange?.(false) } })
      .finally(() => { if (!request.signal.aborted && getToken() === token) setChecking(false) })
    return () => request.abort()
  }, [token, retry, onConnectionChange])
  return <div className="application-extension-status">
    <p role="status">{checking ? 'Checking extension connection…' : token && status ? labels[status] : 'Sign in on JobPilot, then connect the extension from its Chrome popup.'}</p>
    {token && <button type="button" className="link" disabled={checking} onClick={() => { onConnectionChange?.(false); setChecking(true); setRetry(value => value + 1) }}>Check extension connection</button>}
    {status !== 'connected' && <details><summary>How to connect</summary><ol><li>Open this JobPilot page in Chrome with the updated extension installed.</li><li>Open the extension, choose Connect through JobPilot, and confirm this same account.</li><li>Return here and check the connection. Site permissions and a field review are still needed on the employer form.</li></ol></details>}
  </div>
}
