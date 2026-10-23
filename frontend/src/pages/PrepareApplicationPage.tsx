import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import Navbar from '../components/Navbar'
import EmailApplication from '../components/EmailApplication'
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
  const selectedId = savedPdfs.some(resume => resume.id === search.get('resume')) ? search.get('resume')! : ''
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

  const saveDraft = async () => {
    if (!token || !reviewed || pending.current || getToken() !== token) return
    const request = new AbortController()
    pending.current = request
    setBusy(true)
    setSaveError('')
    try {
      await savePreparationDraft(id, { signal: request.signal, timeout: 15000, headers: { Authorization: `Bearer ${token}` } })
      if (!request.signal.aborted && getToken() === token) setSaved(true)
    } catch (cause) {
      if (request.signal.aborted || getToken() !== token) return
      if (axios.isAxiosError(cause) && cause.response?.status === 409) setSaved(true)
      else setSaveError('The preparation record could not be saved. Retry to continue without losing your selected PDF.')
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

  return <div className="page prepare-application-page">
    <Navbar backTo={`/jobs/${id}`} backLabel="Back to job" />
    <main className="container prepare-container">
      <header className="page-header">
        <h1>Prepare application</h1>
        <p>{context ? `${context.job.title} · ${context.job.company}` : 'Review your saved details, choose a PDF, and continue with the employer.'}</p>
      </header>
      <ol className="prepare-steps" aria-label="Application preparation steps">
        <li>Job</li><li>Review saved details and PDF</li><li>Continue</li>
      </ol>
      {!token ? <p className="alert alert-error"><Link to={`/?next=${encodeURIComponent(returnTo)}`}>Sign in to JobPilot</Link> to use your saved details and private PDF library.</p>
        : loading ? <p role="status" className="muted">Loading your application details and saved PDFs…</p>
          : error ? <div role="alert" className="alert alert-error"><p>{error}</p><button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry preparation</button></div>
            : context && <>
              <section className="prepare-section" aria-labelledby="prepare-job-title">
                <div className="prepare-section-heading"><h2 id="prepare-job-title">This application</h2><span className="tag tag-primary">{context.channel_label}</span></div>
                <p>{context.job.title} at {context.job.company}</p>
                {original && <a className="link" href={original} target="_blank" rel="noopener noreferrer">Read the original posting</a>}
              </section>

              <section className="prepare-section" aria-labelledby="prepare-details-title">
                <div className="prepare-section-heading"><h2 id="prepare-details-title">Review saved details and PDF</h2><Link className="link" to={profileLink}>Edit profile and resumes</Link></div>
                <dl className="prepare-details">
                  <div><dt>Name</dt><dd>{context.profile.full_name || 'Not saved'}</dd></div>
                  <div><dt>Contact email</dt><dd>{context.profile.contact_email || 'Not saved'}</dd></div>
                  <div><dt>Phone</dt><dd>{context.profile.phone || 'Not saved'}</dd></div>
                  <div><dt>Availability</dt><dd>{context.profile.availability_period || 'Not saved'}</dd></div>
                </dl>
                <details className="prepare-profile-detail"><summary>Review education, experience and skills</summary>
                  <dl className="prepare-details prepare-long-details">
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
                    if (event.target.value) next.set('resume', event.target.value)
                    else next.delete('resume')
                    setSearch(next, { replace: true })
                    setReviewed(false)
                    setSaved(false)
                    setSaveError('')
                  }}>
                    <option value="">Choose a saved PDF</option>
                    {savedPdfs.map(resume => <option key={resume.id} value={resume.id}>{resume.filename} · {Math.ceil(resume.size_bytes / 1024)} KiB</option>)}
                  </select>
                  {selectedResume ? <div className="prepare-pdf-summary">
                    <p>{selectedResume.filename} · {selectedResume.size_bytes.toLocaleString()} bytes</p>
                    <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void download()}>{busy ? 'Please wait…' : 'Download selected PDF'}</button>
                  </div> : <p className="muted">{savedPdfs.length ? 'Select the file you want to use. Your original PDF stays private to your account.' : 'No uploaded PDF is available. Add the actual file in your profile to reuse it here.'}</p>}
                  {resumes.some(resume => !resume.has_file) && <p className="muted">Older filename-only records cannot be attached. Upload the actual PDF in your profile.</p>}
                  {resumeError && <div role="alert" className="prepare-error"><p>{resumeError}</p><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRetry(value => value + 1)}>Reload saved PDFs</button></div>}
                </div>
              </section>

              <section className="prepare-section" aria-labelledby="prepare-continue-title">
                <h2 id="prepare-continue-title">Continue with this application</h2>
                {context.instructions.length > 0 && <ul className="prepare-instructions">{context.instructions.map((instruction, index) => <li key={index}>{instruction}</li>)}</ul>}
                {context.channel === 'unavailable' ? <p role="status">This application channel is not currently available. Check the original posting for its latest status.</p>
                  : context.channel === 'email' ? <EmailApplication jobId={id} selectedResumeId={selectedResume?.id ?? null} selectedResume={selectedResume} initialBody={initialEmailBody} />
                    : <>
                      <p className="muted">{selectedResume ? 'Download your selected PDF above, then select and upload it on the employer\'s form. JobPilot does not fill external file inputs.' : 'No JobPilot PDF is selected. You will need to choose any required resume file on the employer\'s form yourself.'}</p>
                      {context.channel === 'ats' && <p className="muted">On supported Greenhouse or Lever pages, the JobPilot extension can help review basic fields. Other questions, file uploads, consent and final submission remain yours to complete.</p>}
                      <label className="prepare-confirm"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />I have reviewed my saved details and the PDF selection for this application.</label>
                      {legacyPath ? reviewed ? <Link className="btn btn-primary" to={legacyPath}>Continue preparation</Link> : <button className="btn btn-primary" disabled>Continue preparation</button>
                        : external ? <>
                          {!saved ? <button className="btn btn-primary" disabled={!reviewed || busy} onClick={() => void saveDraft()}>{busy ? 'Saving preparation…' : 'Save preparation'}</button>
                            : <><p role="status">A JobPilot record is saved for this job. Opening the employer's page does not mark it as submitted.</p><a className="btn btn-primary" href={external} target="_blank" rel="noopener noreferrer">Continue on employer site</a><Link className="link" to="/applications">View My Applications</Link></>}
                        </> : <p role="status">No verified application link is available. Follow the original posting's instructions.</p>}
                      {saveError && <p role="alert" className="prepare-error">{saveError}</p>}
                    </>}
              </section>
            </>}
    </main>
  </div>
}
