import { useEffect, useState, useSyncExternalStore } from 'react'
import { getToken, watchSession } from '../services/auth'
import { fetchApplicationContext, type ApplicationContext } from '../services/applicationJourney'
import ExtensionStatus from './ExtensionStatus'
import './ApplicationChannelInfo.css'

const channelText = {
  ats: { title: 'Assisted filling available with extension', description: 'On supported employer forms, reuse saved PDF and Profile answers. Attach your selected PDF with a separate explicit action; personal declarations, consent and final submission remain yours.' },
  internsg: { title: 'InternSG form · extension required for filling', description: 'Review your saved profile, then use the connected extension for supported fields. Files, CAPTCHA and final submission stay on the original form.' },
  external: { title: 'Employer site · manual application', description: 'Your saved profile and PDF are available for preparation. Complete this employer’s form yourself; assisted filling is not supported for this channel.' },
  email: { title: 'Email test pilot · test mailbox only', description: 'Prepare a message using your saved profile and PDF, then review it before sending to the test inbox. This does not deliver an application to the employer.' },
  assistant: { title: 'JobPilot application record', description: 'Reuse your saved details to prepare a local record. This does not send an application to the employer.' },
  unavailable: { title: 'Application channel unavailable', description: 'Check the original posting for the latest availability and instructions.' },
}

export default function ApplicationChannelInfo({ jobId, context, compact = false }: { jobId: string; context?: ApplicationContext; compact?: boolean }) {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <ChannelSession key={`${jobId}:${token ?? ''}`} jobId={jobId} context={context} token={token} compact={compact} />
}

function ChannelSession({ jobId, context, token, compact }: { jobId: string; context?: ApplicationContext; token: string | null; compact: boolean }) {
  const [loaded, setLoaded] = useState<ApplicationContext | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (context || !token) return
    const request = new AbortController()
    fetchApplicationContext(jobId, { signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } })
      .then(result => { if (!request.signal.aborted && getToken() === token) setLoaded(result.data) })
      .catch(() => { if (!request.signal.aborted && getToken() === token) setError(true) })
    return () => request.abort()
  }, [context, jobId, token])
  const current = context ?? loaded
  if (!current) return <div className="application-channel-info"><p className="muted">{!token ? 'Sign in to see this job’s application channel and reuse your saved profile.' : error ? 'The application channel could not be verified. Check it on the preparation page or original posting.' : 'Checking this job’s application channel…'}</p></div>
  const channel = channelText[current.channel]
  const compactText = {
    ats: { title: 'Employer form · assisted filling', description: 'Use Chrome with the extension to reuse saved answers and explicitly attach your selected PDF.' },
    internsg: { title: 'InternSG form · assisted filling', description: 'Review your details, then load and fill the original form with the extension.' },
    external: { title: 'Employer site · manual application', description: 'Prepare your details here, then complete the employer’s form yourself.' },
    email: channelText.email,
    assistant: channelText.assistant,
    unavailable: channelText.unavailable,
  }[current.channel]
  if (compact) return <section className="application-channel-info application-channel-compact" aria-label="Application channel">
    <h2>{compactText.title}</h2><p>{compactText.description}</p>
    {['ats', 'internsg'].includes(current.channel) && <details className="application-channel-connection"><summary>Extension connection</summary><ExtensionStatus key={token ?? ''} token={token} /></details>}
  </section>
  return <section className="application-channel-info" aria-label="Application channel">
    <h3>{channel.title}</h3><p>{channel.description}</p>
    {['ats', 'internsg'].includes(current.channel) && <ExtensionStatus key={token ?? ''} token={token} />}
  </section>
}
