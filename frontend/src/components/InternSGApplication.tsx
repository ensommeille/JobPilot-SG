import { useEffect, useState, type ReactNode } from 'react'
import { watchSession } from '../services/auth'

export default function InternSGApplication({ url, platformManaged = false, onFrameChange, controls }: {
  url: string; platformManaged?: boolean; onFrameChange?: (loaded: boolean) => void; controls?: ReactNode
}) {
  const [loaded, setLoaded] = useState(false)
  const [accountChanged, setAccountChanged] = useState(false)
  const [notice, setNotice] = useState('Waiting for the external page. Loading does not verify form readiness or delivery.')
  useEffect(() => {
    const unwatch = watchSession(() => { setLoaded(false); setAccountChanged(true) })
    return unwatch
  }, [])
  useEffect(() => {
    if (!loaded) return
    const timer = window.setTimeout(() => setNotice('If the form is blank or CAPTCHA fails, open the original application.'), 15000)
    return () => window.clearTimeout(timer)
  }, [loaded])
  return <section id="internsg-original-application" tabIndex={-1} className="external-application stack" aria-label="InternSG application">
    <h2>Original InternSG application</h2>
    {!loaded && <p className="muted">Load the employer&apos;s form, then fill supported fields from your saved details. Nothing is loaded or filled automatically.</p>}
    {accountChanged && <p role="alert">Account changed. The embedded form has been closed to protect the previous account's answers. Check your account before loading a fresh form. Any answers already sent to InternSG are not undone.</p>}
    <div className="external-actions">
      {!loaded && <button type="button" id="internsg-load-application" className="btn btn-primary" onClick={() => { setAccountChanged(false); setNotice('Loading the original application…'); setLoaded(true); onFrameChange?.(false) }}>{platformManaged ? 'Load application form' : 'Load InternSG application here'}</button>}
      <a className="link" href={url} target="_blank" rel="noopener noreferrer">Open original application</a>
    </div>
    {loaded && <>
      {controls}
      <p role="status" className="muted">{notice}</p>
      <iframe data-jobpilot-internsg src={url} title="Original InternSG application form"
        className="internsg-frame" referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onLoad={() => { onFrameChange?.(true); setNotice('Check that the correct form is visible below. Loading does not submit an application.') }}
        onError={() => { onFrameChange?.(false); setNotice('The embedded page could not load. Open the original application instead.') }} />
    </>}
    <details className="preparation-embed-help"><summary>Form, privacy and submission help</summary>
      <p>This is InternSG&apos;s website inside JobPilot. Anything you enter is visible to InternSG. Check the employer and role first.</p>
      <p>CAPTCHA, PDF upload and final submission remain manual. JobPilot does not mark an application as submitted or verify employer receipt.</p>
      {!platformManaged && <p>For assisted filling, connect the JobPilot extension and enable embedded InternSG access, then choose Read page &amp; load profile in its popup.</p>}
      <p>If the form is blank or CAPTCHA fails, open the original application. Closing this page can discard unsaved answers. Do not submit fictional test data.</p>
    </details>
  </section>
}
