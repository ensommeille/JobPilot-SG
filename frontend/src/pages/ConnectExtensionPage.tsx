import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getToken, removeToken } from '../services/auth'
import { extensionMessage } from '../services/extensionConnection'

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
export default function ConnectExtensionPage() {
  const [connection, setConnection] = useState<{id: string; state: string; challenge: string; token: string; email: string} | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const token = getToken()
  const next = '/connect-extension' + window.location.hash

  useEffect(() => {
    if (!token) return
    let active = true
    const params = new URLSearchParams(window.location.hash.slice(1))
    const id = params.get('extension_id') || '', state = params.get('state') || ''
    async function inspect() {
      try {
        if (!/^[a-p]{32}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('Open the JobPilot extension and choose Connect through JobPilot to begin.')
        const detail = await extensionMessage(id, {kind: 'connection-details', state})
        if (detail.api !== new URL(API).origin || detail.client_id !== id || typeof detail.challenge !== 'string') throw new Error('Platform/API configuration does not match this extension. Connection stopped.')
        const response = await fetch(API + '/users/me', {headers: {Authorization: `Bearer ${token}`}, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000)})
        if (response.status === 401) { if (token === getToken()) removeToken(); throw new Error('Platform session expired. Sign in again, then restart from the extension.') }
        if (!response.ok) throw new Error('Could not verify the current account. Try again when online.')
        const user = await response.json()
        if (active && token === getToken()) setConnection({id, state, challenge: detail.challenge, token: token!, email: user.email})
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Connection failed') }
    }
    void inspect()
    return () => { active = false }
  }, [token])

  async function connect() {
    if (!connection || busy) return
    setBusy(true); setError('')
    try {
      if (getToken() !== connection.token) throw new Error('Account changed. Restart the connection from the extension.')
      const response = await fetch(API + '/auth/extension/authorize', {method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}`},
        body: JSON.stringify({client_id: connection.id, challenge: connection.challenge, confirmed: true}), signal: AbortSignal.timeout(15000)})
      if (!response.ok) throw new Error(`Authorization failed (${response.status}). Verify login and the backend extension-ID allowlist.`)
      const data = await response.json()
      if (getToken() !== connection.token) throw new Error('Account changed. Authorization was not delivered; restart the connection.')
      await extensionMessage(connection.id, {kind: 'complete', state: connection.state, code: data.code})
      localStorage.setItem('jobpilot_extension_id', connection.id)
      setDone(true); window.history.replaceState(null, '', '/connect-extension')
    } catch (err) { setError(err instanceof Error ? err.message : 'Connection failed. Start again from the extension.') }
    finally { setBusy(false) }
  }

  return <main className="container" style={{maxWidth: 680, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 16, paddingTop: 32, paddingBottom: 32}}>
    <Link to="/profile">Back to JobPilot profile</Link>
    <h1>Connect JobPilot extension</h1>
    {!token ? <><p>Sign in on JobPilot. You will not enter your password in the extension.</p><Link className="btn btn-primary" to={'/?next=' + encodeURIComponent(next)}>Sign in on JobPilot</Link></> :
      done ? <p role="status">Connected. Return to your application and open the extension to reuse your profile. No second login is needed.</p> : <>
        <p>The extension can read application details and import reviewed device details into empty profile fields. It cannot change other account data or use administrator APIs.</p>
        {connection && <p>Connecting as <strong>{connection.email}</strong>. Extension ID: <span style={{overflowWrap: 'anywhere'}}>{connection.id}</span></p>}
        <p>Logging out of this platform session revokes the connection. CAPTCHA and final application confirmation remain yours.</p>
        <button className="btn btn-primary" disabled={!connection || busy} onClick={connect}>{busy ? 'Connecting…' : 'Confirm and connect extension'}</button>
      </>}
    {error && <p role="alert" className="alert alert-error">{error}</p>}
  </main>
}
