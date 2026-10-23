import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import axios from 'axios'
import { getToken, watchSession } from '../services/auth'
import { deleteResumeFile, downloadResumeFile, fetchResume, listResumes, uploadResumeFile } from '../services/resumes'
import type { ResumeDetail, ResumeFile, ResumeSuggestions } from '../services/resumes'
import './ResumeLibrary.css'

const suggestionFields = [
  ['full_name', 'Full name'], ['contact_email', 'Contact email'], ['phone', 'Phone'],
  ['education', 'Education'], ['experience', 'Experience'], ['skills', 'Skills'],
] as const
type SuggestionField = typeof suggestionFields[number][0]

function resumeError(error: unknown): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string') return error.response.data.detail
  return error instanceof Error && !axios.isAxiosError(error) ? error.message : 'Could not complete this resume action. Your saved profile has not changed. Retry when connected.'
}

export default function ResumeLibrary({ onUseSuggestions }: { onUseSuggestions: (suggestions: ResumeSuggestions) => void }) {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return token ? <Library key={token} token={token} onUseSuggestions={onUseSuggestions} /> : null
}

function Library({ token, onUseSuggestions }: { token: string; onUseSuggestions: (suggestions: ResumeSuggestions) => void }) {
  const [items, setItems] = useState<ResumeFile[]>([])
  const [detail, setDetail] = useState<ResumeDetail | null>(null)
  const [selected, setSelected] = useState<SuggestionField[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const alive = useRef(true)
  const locked = useRef(false)
  const requests = useRef(new Set<AbortController>())
  const upload = useRef<HTMLInputElement>(null)
  const current = (request?: AbortController) => alive.current && getToken() === token && !request?.signal.aborted
  const config = (request: AbortController) => ({ signal: request.signal, timeout: 30000, headers: { Authorization: `Bearer ${token}` } })
  useEffect(() => {
    alive.current = true
    const pending = requests.current
    return () => { alive.current = false; pending.forEach(request => request.abort()); pending.clear() }
  }, [])
  useEffect(() => {
    const request = new AbortController()
    requests.current.add(request)
    listResumes(config(request)).then(result => { if (current(request)) setItems(result.data) })
      .catch(error => { if (current(request)) setError(resumeError(error)) })
      .finally(() => { requests.current.delete(request); if (current(request)) setLoading(false) })
    return () => request.abort()
  // This session component is remounted whenever the authenticated account changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, retry])

  const action = async (label: string, task: (request: AbortController) => Promise<void>) => {
    if (locked.current || !current()) return
    const request = new AbortController()
    requests.current.add(request); locked.current = true
    setBusy(label); setError(''); setNotice('')
    try { await task(request) }
    catch (error) { if (current(request)) setError(resumeError(error)) }
    finally { requests.current.delete(request); locked.current = false; if (current(request)) setBusy('') }
  }
  const refresh = async (request: AbortController) => {
    const result = await listResumes(config(request))
    if (current(request)) setItems(result.data)
  }
  const open = (item: ResumeFile) => void action('Reading saved PDF…', async request => {
    const result = await fetchResume(item.id, config(request))
    if (current(request)) { setDetail(result.data); setSelected([]) }
  })
  const saveFile = (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size < 1 || file.size > 2 * 1024 * 1024) {
      setError('Choose a PDF up to 2 MiB.'); if (upload.current) upload.current.value = ''; return
    }
    void action('Saving and reading PDF…', async request => {
      const result = await uploadResumeFile(file, config(request))
      await refresh(request)
      const read = await fetchResume(result.data.id, config(request))
      if (current(request)) {
        setDetail(read.data); setSelected([])
        setNotice('PDF saved to your account. Check the extracted information before using it.')
        if (upload.current) upload.current.value = ''
      }
    })
  }
  const remove = (item: ResumeFile) => {
    if (!window.confirm(`Delete ${item.filename} from your resume library? Saved profile details and copies already attached to email drafts or sent emails will remain.`)) return
    void action('Deleting saved PDF…', async request => {
      await deleteResumeFile(item.id, config(request))
      if (current(request) && detail?.id === item.id) { setDetail(null); setSelected([]) }
      await refresh(request)
    })
  }
  const useSelected = () => {
    if (!detail || !current() || !selected.length) return
    const chosen = Object.fromEntries(selected.map(key => [key, detail.suggestions[key]])) as ResumeSuggestions
    onUseSuggestions(chosen)
    setNotice('Selected information copied into the profile form below. Check the fields, then select Save Profile to use them for recommendations and applications.')
  }
  const available = detail ? suggestionFields.filter(([key]) => {
    const value = detail.suggestions[key]
    return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim())
  }) : []

  return <section className="resume-library" aria-labelledby="resume-library-heading">
    <h2 id="resume-library-heading">Resume PDFs</h2>
    <p>Save the actual PDF once, then reuse it for applications. Extracted text is private to your account and is read locally without sending it to an AI provider.</p>
    <label htmlFor="resume-library-upload">Upload resume PDF (up to 2 MiB)</label>
    <input ref={upload} id="resume-library-upload" type="file" accept=".pdf,application/pdf" disabled={Boolean(busy) || loading} onChange={event => saveFile(event.target.files?.[0])} />
    {loading && <p role="status">Loading your saved resumes…</p>}
    {!loading && !items.length && <p className="muted">Upload a PDF to review its text and reuse the original file when applying.</p>}
    {items.length > 0 && <ul className="resume-library-files">{items.map(item => <li key={item.id}>
      <div><strong>{item.filename}</strong><p className="muted">{(item.size_bytes / 1024).toFixed(1)} KiB · {item.has_file ? item.extraction_status === 'parsed' ? 'Text extracted — review before use' : 'PDF saved — text needs manual entry' : 'Filename only — upload the actual PDF to reuse it'}</p></div>
      <div className="resume-library-actions">
        {item.has_file && <><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => open(item)}>Review PDF text</button><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => void action('Downloading PDF…', async () => { await downloadResumeFile(item.id, item.filename, token) })}>Download PDF</button></>}
        <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => remove(item)}>Delete</button>
      </div>
    </li>)}</ul>}
    {detail && <div className="resume-text-review" aria-label="Review extracted resume">
      <h3>Review information from {detail.filename}</h3>
      <p>{detail.notice || 'PDF text extraction can mix columns or miss information. Compare with your original resume.'}</p>
      {detail.extraction_status === 'needs_text' && <p>The PDF is saved and can still be attached to an email. No usable text was found. For recommendations and form filling, enter your skills and experience in the profile below, or upload a text-based PDF.</p>}
      {detail.text && <details><summary>Read extracted PDF text</summary><pre>{detail.text}</pre></details>}
      {available.length > 0 && <>
        <p>Select only information you have checked. Selected contact, education and experience fields replace those fields in the editable profile below; skills are added to your existing skills. Nothing is saved to your profile until you select Save Profile.</p>
        <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => setSelected(available.map(([key]) => key))}>Select all extracted fields</button>
        <dl>{available.map(([key, label]) => <div key={key} className="resume-suggestion"><dt><label><input type="checkbox" disabled={Boolean(busy)} checked={selected.includes(key)} onChange={event => setSelected(previous => event.target.checked ? [...previous, key] : previous.filter(item => item !== key))} />Use extracted {label.toLowerCase()}</label></dt><dd>{Array.isArray(detail.suggestions[key]) ? (detail.suggestions[key] as string[]).join(', ') : detail.suggestions[key]}</dd></div>)}</dl>
        <button type="button" className="btn btn-primary" disabled={Boolean(busy) || !selected.length} onClick={useSelected}>Copy selected fields to profile form</button>
      </>}
    </div>}
    {busy && <p role="status">{busy}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => { setError(''); setLoading(true); setRetry(value => value + 1) }}>Reload resume list</button></div>}
  </section>
}
