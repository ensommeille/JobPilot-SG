import { useEffect, useState } from 'react'
import { watchSession } from '../services/auth'

export default function InternSGApplication({ url, platformManaged = false, onFrameChange }: {
  url: string; platformManaged?: boolean; onFrameChange?: (loaded: boolean) => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [accountChanged, setAccountChanged] = useState(false)
  const [notice, setNotice] = useState('Waiting for the external page. Loading does not verify form readiness or delivery.')
  useEffect(() => {
    const timer = window.setTimeout(() => setNotice('If the form is blank or CAPTCHA does not work, open the original site. Browser privacy settings may affect embedded pages.'), 15000)
    const unwatch = watchSession(() => { setLoaded(false); setAccountChanged(true) })
    return () => { window.clearTimeout(timer); unwatch() }
  }, [])
  return <section className="external-application stack" aria-label="InternSG application">
    <h2>Original InternSG application</h2>
    <p className="muted">This is InternSG&apos;s website inside JobPilot, not a JobPilot form. Entered information is visible to InternSG. Check the employer and role before filling.</p>
    {platformManaged
      ? <p className="muted">Use the reviewed answers above to fill this form. Check the employer and every filled answer here. CAPTCHA and final submission remain your own actions.</p>
      : <p className="muted">For assisted filling, open the JobPilot extension, choose Connect through JobPilot and confirm your account on the platform once per connection. Enable embedded InternSG access, then choose Read page &amp; load profile. No password is entered in the extension; your platform login token is never sent to InternSG.</p>}
    {accountChanged && <p role="alert">Account changed. The embedded form has been closed to protect the previous account's answers. Check your account before loading a fresh form. Any answers already sent to InternSG are not undone.</p>}
    <div className="external-actions">
      {!loaded && <button className="btn btn-primary" onClick={() => { setAccountChanged(false); setLoaded(true); onFrameChange?.(false) }}>Load InternSG application here</button>}
      <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer">Open original application</a>
    </div>
    {loaded && <>
      <p role="status" className="muted">{notice}</p>
      <iframe data-jobpilot-internsg src={url} title="Original InternSG application form"
        className="internsg-frame" referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onLoad={() => { onFrameChange?.(true); setNotice('The frame finished a navigation. Check that the form and CAPTCHA are visible; this does not mean an application was sent.') }}
        onError={() => { onFrameChange?.(false); setNotice('The embedded page could not load. Open the original application instead.') }} />
      <p className="external-warning">No application status is updated automatically. CAPTCHA and any real submission require your own action. Do not submit fictional test data. Closing this page can discard unsaved answers.</p>
    </>}
  </section>
}
