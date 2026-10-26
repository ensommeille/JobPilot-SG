import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import axios from 'axios'
import { getToken, watchSession } from '../services/auth'
import { deleteResumeFile, downloadResumeFile, fetchResume, listResumes, uploadResumeFile } from '../services/resumes'
import type { ResumeDetail, ResumeFile } from '../services/resumes'
import { readResumeForAutofill } from '../services/autofill'
import type { PdfActionGate } from '../services/autofill'
import './ResumeLibrary.css'

function resumeError(error: unknown): string {
  if (axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string') return error.response.data.detail
  return error instanceof Error && !axios.isAxiosError(error) ? error.message : 'Could not complete this resume action. Your saved profile has not changed. Retry when connected.'
}

export default function ResumeLibrary({ onFilesChanged, pdfGate }: { onFilesChanged?: () => void; pdfGate: PdfActionGate }) {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return token ? <Library key={token} token={token} onFilesChanged={onFilesChanged} pdfGate={pdfGate} /> : null
}

function Library({ token, onFilesChanged, pdfGate }: { token: string; onFilesChanged?: () => void; pdfGate: PdfActionGate }) {
  const [items, setItems] = useState<ResumeFile[]>([])
  const [detail, setDetail] = useState<ResumeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [uploadFilename, setUploadFilename] = useState('')
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

  const action = async (label: string, task: (request: AbortController) => Promise<void>, preparesPdf = false) => {
    if (locked.current || pdfGate.busy || !current()) return
    const lease = preparesPdf ? pdfGate.acquire() : null
    if (preparesPdf && lease === null) return
    const request = new AbortController()
    requests.current.add(request); locked.current = true
    setBusy(label); setError(''); setNotice('')
    try { await task(request) }
    catch (error) { if (current(request)) setError(resumeError(error)) }
    finally { requests.current.delete(request); locked.current = false; if (lease !== null) pdfGate.release(lease); if (current(request)) setBusy('') }
  }
  const refresh = async (request: AbortController) => {
    const result = await listResumes(config(request))
    if (current(request)) setItems(result.data)
  }
  const open = (item: ResumeFile) => void action('Reading saved PDF…', async request => {
    const result = await fetchResume(item.id, config(request))
    if (current(request)) { setDetail(result.data) }
  })
  const saveFile = (file?: File) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size < 1 || file.size > 2 * 1024 * 1024) {
      setError('Choose a PDF up to 2 MiB.'); setUploadFilename(''); if (upload.current) upload.current.value = ''; return
    }
    setUploadFilename(file.name)
    void action('Uploading your PDF…', async request => {
      const result = await uploadResumeFile(file, config(request))
      if (!current(request)) return
      setDetail(null)
      if (upload.current) upload.current.value = ''
      setUploadFilename('')
      setBusy('Preparing your PDF for applications…')
      try {
        const prepared = await readResumeForAutofill(result.data.id, config(request))
        if (!current(request)) return
        if (prepared.data.status === 'ready') setNotice(prepared.data.reused ? 'PDF ready. Saved answers were reused without a new analysis.' : 'PDF ready for applications. Your saved Profile answers still take priority.')
        else setError('Your PDF is saved, but its answers could not be prepared. Add missing details manually or choose another PDF. Existing saved answers are retained.')
      } catch (error) {
        if (!current(request)) return
        setError(axios.isAxiosError(error) && error.response?.status === 409
          ? 'Your PDF is saved and preparation is already running. Refresh saved answers to check its result; no retry was started.'
          : 'Your PDF is saved, but preparation did not complete. Refresh saved answers to check the result, or add details manually. No retry was started.')
      }
      if (!current(request)) return
      try { await refresh(request) } catch { /* The saved PDF and analysis result remain on the server. */ }
      if (current(request)) onFilesChanged?.()
    }, true)
  }
  const remove = (item: ResumeFile) => {
    if (!window.confirm(`Delete ${item.filename} from your resume library? Saved profile details and copies already attached to email drafts or sent emails will remain.`)) return
    void action('Deleting saved PDF…', async request => {
      await deleteResumeFile(item.id, config(request))
      if (current(request) && detail?.id === item.id) { setDetail(null) }
      await refresh(request)
      if (current(request)) onFilesChanged?.()
    })
  }
  return <section className="resume-library" aria-labelledby="resume-library-heading">
    <h2 id="resume-library-heading">Resume PDFs</h2>
    <p>Upload once to prepare reusable answers and save the original file for applications.</p>
    <label htmlFor="resume-library-upload">Upload and analyze PDF with AI (up to 2 MiB)</label>
    <p id="resume-upload-cost" className="muted">Choosing a file starts preparation. A new AI analysis may be billed; saved readings are reused. No application or employer upload is sent.</p>
    <div className="resume-upload-control">
      <span className="resume-upload-picker">
        <span className="btn btn-secondary" aria-hidden="true">Choose PDF</span>
        <input ref={upload} id="resume-library-upload" type="file" accept=".pdf,application/pdf" aria-describedby="resume-upload-cost resume-upload-filename" title="Choose a PDF resume" disabled={Boolean(busy) || loading || pdfGate.busy} onChange={event => saveFile(event.target.files?.[0])} />
      </span>
      <span id="resume-upload-filename" className="muted" aria-live="polite" aria-atomic="true">{uploadFilename || 'No file selected'}</span>
    </div>
    {loading && <p role="status">Loading your saved resumes…</p>}
    {!loading && !items.length && <p className="muted">Upload a PDF to review its text and reuse the original file when applying.</p>}
    {items.length > 0 && <ul className="resume-library-files">{items.map(item => <li key={item.id}>
      <div><strong>{item.filename}</strong><p className="muted">{(item.size_bytes / 1024).toFixed(1)} KiB · {new Date(item.uploaded_at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })} · {item.has_file ? item.extraction_status === 'parsed' ? 'PDF saved' : 'PDF saved — text unavailable' : 'Filename only — upload the actual PDF to reuse it'}</p></div>
      <div className="resume-library-actions">
        {item.has_file && <><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy) || pdfGate.busy} onClick={() => open(item)}>Review PDF text</button><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy) || pdfGate.busy} onClick={() => void action('Downloading PDF…', async () => { await downloadResumeFile(item.id, item.filename, token) })}>Download PDF</button></>}
        <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy) || pdfGate.busy} onClick={() => remove(item)}>Delete</button>
      </div>
    </li>)}</ul>}
    {detail && <div className="resume-text-review" aria-label="Review extracted resume">
      <h3>Review information from {detail.filename}</h3>
      <p>{detail.notice || 'PDF text extraction can mix columns or miss information. Compare with your original resume.'}</p>
      {detail.extraction_status === 'needs_text' && <p>No usable text was found. The saved PDF can still be attached explicitly, but autofill needs a text-based PDF or your saved Profile answers.</p>}
      {detail.text && <details><summary>Read extracted PDF text</summary><pre>{detail.text}</pre></details>}
    </div>}
    {busy && <p role="status">{busy}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => { setError(''); setLoading(true); setRetry(value => value + 1) }}>Reload resume list</button></div>}
  </section>
}
