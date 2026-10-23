import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { getToken, watchSession } from '../services/auth'
import { emailError, emailStatus } from '../services/emailApplications'
import type { EmailDraft, EmailOption, EmailPreview } from '../services/emailApplications'
import type { ResumeFile } from '../services/resumes'
import './EmailApplication.css'

interface EmailApplicationProps {
  jobId: string
  selectedResumeId: string | null
  selectedResume: ResumeFile | null
  initialBody?: string
  onAvailabilityChange?: (available: boolean) => void
}

export default function EmailApplication(props: EmailApplicationProps) {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return token ? <EmailSession key={`${props.jobId}:${token}`} {...props} token={token} /> : null
}

function EmailSession({ jobId, token, selectedResumeId, selectedResume, initialBody, onAvailabilityChange }: EmailApplicationProps & { token: string }) {
  const [option, setOption] = useState<EmailOption | null>(null)
  const [application, setApplication] = useState<EmailDraft | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [preview, setPreview] = useState<(EmailPreview & { resumeId: string }) | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const selectedFile = selectedResume?.has_file && selectedResume.id === selectedResumeId ? selectedResume : null
  const selectionKey = `${selectedResumeId ?? ''}:${selectedFile?.sha256 ?? ''}:${selectedFile?.filename ?? ''}`
  const [previousSelection, setPreviousSelection] = useState(selectionKey)
  const requests = useRef(new Set<AbortController>())
  const alive = useRef(true)
  // Reset only the review when the chosen file changes, keeping unsaved message edits.
  if (previousSelection !== selectionKey) {
    setPreviousSelection(selectionKey)
    setPreview(null)
    setConfirmed(false)
  }
  const activePreview = preview && preview.resumeId === selectedResumeId
    && preview.application.attachment?.sha256 === selectedFile?.sha256
    && preview.application.attachment?.filename === selectedFile?.filename
    && preview.application.subject === subject && preview.application.body === body ? preview : null

  useEffect(() => {
    alive.current = true
    const pending = requests.current
    return () => { alive.current = false; pending.forEach(request => request.abort()); pending.clear() }
  }, [])
  const isCurrent = (request?: AbortController) => alive.current && getToken() === token && !request?.signal.aborted
  const config = useCallback((request: AbortController) => ({ signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } }), [token])
  const accept = (draft: EmailDraft) => {
    setApplication(draft); setSubject(draft.subject); setBody(draft.body)
    setPreview(null); setConfirmed(false)
  }
  useEffect(() => {
    const request = new AbortController()
    requests.current.add(request)
    api.get(`/jobs/${jobId}/email-application-option`, config(request))
      .then(async response => {
        if (request.signal.aborted || getToken() !== token) return
        const channel: EmailOption = response.data
        setOption(channel)
        onAvailabilityChange?.(channel.available)
        if (channel.existing_application_id) {
          const saved = await api.get(`/email-applications/${channel.existing_application_id}`, config(request))
          if (!request.signal.aborted && getToken() === token) accept(saved.data)
        }
      })
      .catch(error => { if (!request.signal.aborted && getToken() === token) setError(emailError(error)) })
      .finally(() => requests.current.delete(request))
    return () => request.abort()
  }, [jobId, token, retry, onAvailabilityChange, config])

  const action = async (label: string, task: (request: AbortController) => Promise<void>) => {
    if (busy || !isCurrent()) return
    const request = new AbortController(); requests.current.add(request)
    setBusy(label); setError('')
    try { await task(request) }
    catch (error) { if (isCurrent(request)) { setError(emailError(error)); setPreview(null); setConfirmed(false) } }
    finally { requests.current.delete(request); if (isCurrent(request)) setBusy('') }
  }
  const invalidate = () => { setPreview(null); setConfirmed(false) }
  const prepare = () => void action('Preparing draft…', async request => {
    if (!selectedFile) return
    const result = await api.post(`/jobs/${jobId}/email-applications`, { resume_id: selectedFile.id, ...(initialBody ? { body: initialBody } : {}) }, config(request))
    if (isCurrent(request)) accept(result.data)
  })
  const review = () => void action('Saving and reviewing…', async request => {
    if (!application || !selectedFile) return
    await api.put(`/email-applications/${application.id}`, { subject, body, resume_id: selectedFile.id }, config(request))
    if (!isCurrent(request)) return
    const result = await api.post<EmailPreview>(`/email-applications/${application.id}/preview`, {}, config(request))
    if (isCurrent(request)) {
      setApplication(result.data.application)
      setConfirmed(false)
      if (result.data.application.attachment?.sha256 !== selectedFile.sha256 || result.data.application.attachment?.filename !== selectedFile.filename) {
        setError('The saved PDF changed. Reload your resume library and review the attachment again.')
        setPreview(null)
        return
      }
      setPreview({ ...result.data, resumeId: selectedFile.id })
    }
  })
  const reload = () => void action('Loading saved email…', async request => {
    if (!application) { setRetry(value => value + 1); return }
    const result = await api.get(`/email-applications/${application.id}`, config(request))
    if (isCurrent(request)) accept(result.data)
  })
  const send = () => void action('Sending to test inbox…', async request => {
    if (!activePreview || !confirmed || !application) return
    const result = await api.post(`/email-applications/${application.id}/send`, { confirmed: true, review_token: activePreview.review_token }, config(request))
    if (isCurrent(request)) accept(result.data)
  })
  if (!option && !error) return <p role="status" className="muted">Loading the email channel and saved draft…</p>
  if (option && !option.available && !error) return <p role="status">{option.notice || 'This email channel is no longer available. Follow the original posting for current instructions.'}</p>
  const draft = application?.status === 'draft'
  const hasPdf = Boolean(selectedFile?.sha256)
  return <section className="email-application" aria-label="Email application pilot">
    <h3>Email application · test pilot</h3>
    {option?.available && <>
      <p>This programme accepts email applications. In this pilot, your message goes to a local test inbox; the employer is not contacted.</p>
      <dl className="email-channel">
        <div><dt>Employer's published address</dt><dd>{option.original_recipient}</dd></div>
        <div><dt>Actual test recipient</dt><dd>{option.actual_recipient || 'Test mailbox not configured'}</dd></div>
      </dl>
      <details><summary>Official application instructions</summary><blockquote>{option.evidence}</blockquote><a href={option.source_url} target="_blank" rel="noopener noreferrer">Read the employer's instructions</a></details>
      {option.mode === 'disabled' && <p className="email-note">Sending is disabled. You can prepare a draft; a test mailbox must be configured before sending.</p>}
      {!application && <button className="btn btn-primary" disabled={Boolean(busy) || !hasPdf} onClick={prepare}>Prepare email draft with selected PDF</button>}
    </>}
    {(!application || draft) && <p className="muted">{hasPdf ? `Selected library PDF: ${selectedFile?.filename}. Its actual saved bytes will be attached when you review.` : 'Choose an uploaded PDF above before preparing or reviewing an email. A filename-only record cannot be attached.'}</p>}
    {application && <>
      <p role="status" className="email-state">{emailStatus(application.status)}</p>
      {draft ? <>
        <div className="field"><label htmlFor={`email-subject-${jobId}`}>Email subject</label><input className="input" id={`email-subject-${jobId}`} value={subject} maxLength={300} disabled={Boolean(busy)} onChange={event => { setSubject(event.target.value); invalidate() }} /></div>
        <div className="field"><label htmlFor={`email-body-${jobId}`}>Message</label><textarea id={`email-body-${jobId}`} value={body} maxLength={20000} rows={10} disabled={Boolean(busy)} onChange={event => { setBody(event.target.value); invalidate() }} /></div>
        <p className="muted">Replies go to {application.reply_to}. Edit your saved contact email in your profile if needed.</p>
        {application.attachment && <p className="muted">Saved draft attachment: {application.attachment.filename}. Saving a new review uses the PDF selected above.</p>}
        <button className="btn btn-primary" disabled={Boolean(busy) || !hasPdf || !subject.trim() || !body.trim()} onClick={review}>Save and review email</button>
        {activePreview && <div className="email-review" aria-label="Final email review">
          <h4>Review before sending</h4>
          <dl className="email-channel"><div><dt>To</dt><dd>{activePreview.application.actual_recipient || 'Sending disabled'}</dd></div><div><dt>Reply-To</dt><dd>{activePreview.application.reply_to}</dd></div><div><dt>Subject</dt><dd>{activePreview.application.subject}</dd></div><div><dt>PDF attachment</dt><dd>{activePreview.application.attachment?.filename} · {activePreview.application.attachment?.size_bytes} bytes</dd></div></dl>
          <p className="email-message">{activePreview.application.body}</p>
          <label className="email-confirm"><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={event => setConfirmed(event.target.checked)} />I have checked the recipient, message and selected PDF attachment.</label>
          <button className="btn btn-primary" disabled={Boolean(busy) || !confirmed || activePreview.application.mode !== 'test_smtp'} onClick={send}>Send to test inbox</button>
          <p className="muted">This sends one test email. The employer will not receive it.</p>
        </div>}
      </> : <>
        <p>{application.status === 'sent' ? 'The local test mailbox accepted this email. This is not an employer receipt or a verified job application.' : 'No automatic retry will be made. Check the saved record and test inbox before taking further action.'}</p>
        <p>Actual recipient: {application.actual_recipient}</p>
        {application.receipt?.message_id && <p className="email-reference">Message reference: {application.receipt.message_id}</p>}
      </>}
      <div className="row" style={{ flexWrap: 'wrap' }}><button className="btn btn-secondary" disabled={Boolean(busy)} onClick={reload}>Reload saved email</button><Link className="link" to="/applications">View My Applications</Link></div>
    </>}
    {busy && <p role="status">{busy}</p>}
    {error && <div role="alert"><p>{error}</p>{!application && <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => { setError(''); setRetry(value => value + 1) }}>Retry email options</button>}</div>}
  </section>
}
