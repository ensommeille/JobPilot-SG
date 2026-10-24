import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import Navbar from '../components/Navbar'
import EmailApplication from '../components/EmailApplication'
import ApplicationChannelInfo from '../components/ApplicationChannelInfo'
import { getToken, watchSession } from '../services/auth'
import { fetchApplicationContext, savePreparationDraft, type ApplicationContext } from '../services/applicationJourney'
import { downloadResumeFile, listResumes, type ResumeFile } from '../services/resumes'
import './PrepareApplicationPage.css'

function officialUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

function uploadedLabel(resume: ResumeFile): string {
  const date = new Date(resume.uploaded_at)
  const time = Number.isNaN(date.getTime()) ? 'Upload time unavailable' : date.toLocaleString('en-SG', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  return `${time} · ${resume.id.slice(0, 8)}`
}

export default function PrepareApplicationPage() {
  const { id = '' } = useParams()
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return <PreparationSession key={`${id}:${token ?? ''}`} id={id} token={token} />
}

function PreparationSession({ id, token }: { id: string; token: string | null }) {
  const [context, setContext] = useState<ApplicationContext | null>(null)
  const [resumes, setResumes] = useState<ResumeFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resumeError, setResumeError] = useState('')
  const [retry, setRetry] = useState(0)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const pending = useRef<AbortController | null>(null)
  const [search, setSearch] = useSearchParams()
  const location = useLocation()
  const savedPdfs = resumes.filter(resume => resume.has_file)
  const selectedId = savedPdfs.some(resume => resume.id === search.get('resume')) ? search.get('resume')!
    : !search.has('resume') && savedPdfs.length === 1 ? savedPdfs[0].id : ''
  const selectedResume = savedPdfs.find(resume => resume.id === selectedId) ?? null
  const returnTo = location.pathname + location.search
  const profileLink = `/profile?returnTo=${encodeURIComponent(returnTo)}`

  useEffect(() => {
    const request = new AbortController()
    const current = () => !request.signal.aborted && getToken() === token
    const load = async () => {
      setLoading(true)
      setError('')
      setResumeError('')
      if (!token) { setLoading(false); return }
      const config = { signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } }
      const [application, files] = await Promise.allSettled([
        fetchApplicationContext(id, config), listResumes(config),
      ])
      if (!current()) return
      if (application.status === 'fulfilled') setContext(application.value.data)
      else setError('Could not load this application. Retry, or return to the job listing.')
      if (files.status === 'fulfilled') setResumes(files.value.data)
      else setResumeError('Your saved PDFs could not be loaded. Retry before selecting an attachment.')
      setLoading(false)
    }
    void load()
    return () => request.abort()
  }, [id, token, retry])

  useEffect(() => () => { pending.current?.abort() }, [])

  const download = async () => {
    if (!token || !selectedResume || getToken() !== token || busy) return
    setBusy(true)
    setResumeError('')
    try { await downloadResumeFile(selectedResume.id, selectedResume.filename, token) }
    catch { if (getToken() === token) setResumeError('The PDF could not be downloaded. Reload your library and try again.') }
    finally { if (getToken() === token) setBusy(false) }
  }

  const saveDraft = async (): Promise<boolean> => {
    if (!token || !reviewed || pending.current || getToken() !== token) return false
    const request = new AbortController()
    pending.current = request
    setBusy(true)
    setSaveError('')
    try {
      await savePreparationDraft(id, { signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } })
      if (!request.signal.aborted && getToken() === token) { setSaved(true); return true }
      return false
    } catch (cause) {
      if (request.signal.aborted || getToken() !== token) return false
      if (axios.isAxiosError(cause) && cause.response?.status === 409) { setSaved(true); return true }
      setSaveError('Could not save a preparation record. Try continuing again; your selected PDF is still here.')
      return false
    } finally {
      if (pending.current === request) pending.current = null
      if (!request.signal.aborted && getToken() === token) setBusy(false)
    }
  }

  const external = officialUrl(context?.original_application_url)
  const original = officialUrl(context?.job.source_url)
  const initialEmailBody = context ? [
    'Dear Recruitment Team,',
    `I would like to apply for ${context.job.title}. Please find my CV attached.`,
    context.profile.resume_summary,
    context.profile.availability_period ? `Availability: ${context.profile.availability_period}` : null,
    `Kind regards,\n${context.profile.full_name || context.profile.contact_email || ''}`,
  ].filter(Boolean).join('\n\n') : undefined
  const legacyPath = context?.channel === 'internsg' && context.preparation_url === `/jobs/${id}/apply-external`
    ? context.preparation_url
    : context?.channel === 'assistant' && context.preparation_url === `/jobs/${id}/apply`
      ? context.preparation_url : null
  const missingDetails = context ? [
    ['Name', context.profile.full_name], ['Contact email', context.profile.contact_email],
    ['Phone', context.profile.phone], ['Availability', context.profile.availability_period],
  ].filter(([, value]) => !value).map(([label]) => label) : []

  const continueExternal = async () => {
    if (!external || busy || !reviewed || getToken() !== token) return
    if (saved || await saveDraft()) window.location.assign(external)
  }

  return <div className="page prepare-application-page">
    <Navbar backTo={`/jobs/${id}`} backLabel="Back to job" />
    <main className="container prepare-container">
      <header className="page-header">
        <h1>Prepare application</h1>
        <p>{context ? `${context.job.title} · ${context.job.company}` : 'Review your saved details and resume, then continue.'}</p>
      </header>
      {!token ? <p className="alert alert-error"><Link to={`/?next=${encodeURIComponent(returnTo)}`}>Sign in to JobPilot</Link> to use your saved details and private PDF library.</p>
        : loading ? <p role="status" className="muted">Loading your application details and saved PDFs…</p>
          : error ? <div role="alert" className="alert alert-error"><p>{error}</p><button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry preparation</button></div>
            : context && <>
              <ApplicationChannelInfo jobId={id} context={context} compact />

              <section className="prepare-section" aria-labelledby="prepare-details-title">
                <div className="prepare-section-heading"><h2 id="prepare-details-title">Your saved details</h2><Link className="link" to={profileLink}>Edit profile</Link></div>
                <p className="prepare-profile-summary">{context.profile.full_name || 'Name not saved'}{context.profile.contact_email ? ` · ${context.profile.contact_email}` : ''}</p>
                {missingDetails.length > 0 && <p className="muted prepare-missing">Not saved: {missingDetails.join(', ')}. Add only what this employer needs.</p>}
                <details className="prepare-profile-detail"><summary>Review saved profile</summary>
                  <dl className="prepare-details prepare-long-details">
                    <div><dt>Name</dt><dd>{context.profile.full_name || 'Not saved'}</dd></div>
                    <div><dt>Contact email</dt><dd>{context.profile.contact_email || 'Not saved'}</dd></div>
                    <div><dt>Phone</dt><dd>{context.profile.phone || 'Not saved'}</dd></div>
                    <div><dt>Availability</dt><dd>{context.profile.availability_period || 'Not saved'}</dd></div>
                    <div><dt>Introduction</dt><dd>{context.profile.resume_summary || 'Not saved'}</dd></div>
                    <div><dt>Education</dt><dd>{context.profile.education || 'Not saved'}</dd></div>
                    <div><dt>Experience</dt><dd>{context.profile.experience || 'Not saved'}</dd></div>
                    <div><dt>Skills</dt><dd>{context.profile.skills.length ? context.profile.skills.join(', ') : 'Not saved'}</dd></div>
                  </dl>
                </details>
                <div className="field prepare-pdf-field">
                  <label className="label" htmlFor="application-resume">Resume PDF for this application</label>
                  <select id="application-resume" className="select" value={selectedId} disabled={busy || savedPdfs.length === 0} onChange={event => {
                    const next = new URLSearchParams(search)
                    next.set('resume', event.target.value)
                    setSearch(next, { replace: true })
                    setReviewed(false)
                    setSaved(false)
                    setSaveError('')
                  }}>
                    <option value="">Choose a saved PDF</option>
                    {savedPdfs.map(resume => <option key={resume.id} value={resume.id}>{savedPdfs.some(other => other.id !== resume.id && other.filename === resume.filename) ? `${uploadedLabel(resume)} · ${resume.filename}` : resume.filename} · {Math.ceil(resume.size_bytes / 1024)} KiB</option>)}
                  </select>
                  {selectedResume ? <div className="prepare-pdf-summary">
                    <p className="muted">Saved PDF: {selectedResume.filename} · {Math.ceil(selectedResume.size_bytes / 1024)} KiB</p>
                    <button className="link" disabled={busy} onClick={() => void download()}>{busy ? 'Please wait…' : 'Download PDF'}</button>
                  </div> : <p className="muted">{savedPdfs.length ? 'Select the file you want to use. Your original PDF stays private to your account.' : 'No uploaded PDF is available. Add the actual file in your profile to reuse it here.'}</p>}
                  {resumes.some(resume => !resume.has_file) && <p className="muted">Older filename-only records cannot be attached. Upload the actual PDF in your profile.</p>}
                  {resumeError && <div role="alert" className="prepare-error"><p>{resumeError}</p><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRetry(value => value + 1)}>Reload saved PDFs</button></div>}
                </div>
              </section>

              <section className="prepare-section" aria-labelledby="prepare-continue-title">
                <h2 id="prepare-continue-title" className="sr-only">Continue with this application</h2>
                {context.channel === 'unavailable' ? <p role="status">This application channel is not currently available. Check the original posting for its latest status.</p>
                  : context.channel === 'email' ? <EmailApplication jobId={id} selectedResumeId={selectedResume?.id ?? null} selectedResume={selectedResume} initialBody={initialEmailBody} />
                    : <>
                      <label className="prepare-confirm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />I have reviewed my saved details and PDF selection.</label>
                      {legacyPath ? reviewed ? <Link className="btn btn-primary" to={legacyPath}>{context.channel === 'assistant' ? 'Continue preparation' : 'Continue to form'}</Link> : <button className="btn btn-primary" disabled>{context.channel === 'assistant' ? 'Continue preparation' : 'Continue to form'}</button>
                        : external ? <>
                          <button className="btn btn-primary" disabled={!reviewed || busy} onClick={() => void continueExternal()}>{busy ? 'Opening employer form…' : context.channel === 'ats' ? 'Open employer form' : 'Continue on employer site'}</button>
                          {saved && <p role="status" className="muted">A JobPilot record exists for this job. Continuing does not mark it as submitted.</p>}
                        </> : <p role="status">No verified application link is available. Follow the original posting's instructions.</p>}
                      <p className="muted prepare-next-note">{context.channel === 'assistant' ? 'This creates a local record. It does not send an application to the employer.' : 'Upload your PDF and complete final submission on the original form.'}</p>
                      {saveError && <p role="alert" className="prepare-error">{saveError}</p>}
                    </>}
                {(context.instructions.length > 0 || original) && <details className="prepare-help"><summary>Application instructions</summary>
                  {context.instructions.length > 0 && <ul className="prepare-instructions">{context.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ul>}
                  {original && <a className="link" href={original} target="_blank" rel="noopener noreferrer">Read the original posting</a>}
                </details>}
              </section>
            </>}
    </main>
  </div>
}
