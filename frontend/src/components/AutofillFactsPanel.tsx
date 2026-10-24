import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import axios from 'axios'
import { getToken, watchSession } from '../services/auth'
import { autofillFields, fetchAutofillProfile, readResumeForAutofill, updateAutofillDetails } from '../services/autofill'
import type { AutofillProfile, PdfActionGate } from '../services/autofill'
import './AutofillFactsPanel.css'

const labels = Object.fromEntries(autofillFields)
const sourceLabels = { profile: 'Saved Profile', manual: 'Your added detail', resume: 'Resume PDF' }
function message(error: unknown) {
  if (axios.isAxiosError(error) && typeof error.response?.data?.detail === 'string') return error.response.data.detail
  return 'Could not complete this action. Your saved answers are retained. Refresh saved answers before trying again.'
}

export default function AutofillFactsPanel({ revision = 0, pdfGate }: { revision?: number; pdfGate: PdfActionGate }) {
  const token = useSyncExternalStore(watchSession, getToken, getToken)
  return token ? <Facts key={token} token={token} revision={revision} pdfGate={pdfGate} /> : null
}

function Facts({ token, revision, pdfGate }: { token: string; revision: number; pdfGate: PdfActionGate }) {
  const [profile, setProfile] = useState<AutofillProfile | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [editKey, setEditKey] = useState('')
  const [editValue, setEditValue] = useState('')
  const alive = useRef(true), locked = useRef(false)
  const readVersion = useRef(0)
  const requests = useRef(new Set<AbortController>())
  const current = (request?: AbortController) => alive.current && getToken() === token && !request?.signal.aborted
  const config = (request: AbortController) => ({ signal: request.signal, timeout: 30000, headers: { Authorization: `Bearer ${token}` } })
  useEffect(() => {
    alive.current = true
    const pending = requests.current
    return () => { alive.current = false; pending.forEach(request => request.abort()); pending.clear() }
  }, [])
  useEffect(() => {
    const request = new AbortController()
    const version = ++readVersion.current
    requests.current.add(request)
    fetchAutofillProfile(config(request)).then(result => {
      if (current(request) && readVersion.current === version) { setProfile(result.data); setError('') }
    }).catch(error => { if (current(request) && readVersion.current === version) setError(message(error)) })
      .finally(() => requests.current.delete(request))
    return () => request.abort()
  // The account-specific component remounts when the token changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, revision, retry])

  const act = async (label: string, task: (request: AbortController) => Promise<void>, preparesPdf = false) => {
    if (locked.current || pdfGate.busy || !current()) return
    const lease = preparesPdf ? pdfGate.acquire() : null
    if (preparesPdf && lease === null) return
    const request = new AbortController()
    readVersion.current++
    requests.current.add(request); locked.current = true
    setBusy(label); setError(''); setNotice('')
    try { await task(request) }
    catch (error) {
      if (current(request)) setError(preparesPdf
        ? axios.isAxiosError(error) && error.response?.status === 409
          ? 'This PDF is already being prepared. Refresh saved answers to check its result. No retry was started.'
          : 'Your PDF is saved, but preparation did not complete. Refresh saved answers to check the result, or add details manually. No retry was started.'
        : message(error))
    }
    finally { requests.current.delete(request); locked.current = false; if (lease !== null) pdfGate.release(lease); if (current(request)) setBusy('') }
  }
  const prepareSelected = async (id: string, request: AbortController) => {
    const result = await readResumeForAutofill(id, config(request))
    if (!current(request)) return
    const refreshed = await fetchAutofillProfile(config(request))
    if (!current(request)) return
    setProfile(refreshed.data)
    if (result.data.status === 'failed') {
      if (refreshed.data.extraction_status !== 'failed') setError('Your PDF is saved, but its answers could not be prepared. Add missing details manually or choose another PDF.')
    } else setNotice(result.data.reused ? 'PDF ready. Saved answers were reused without a new analysis.' : 'PDF ready for applications. Your existing saved Profile answers take priority.')
  }
  const read = () => {
    const resume = profile?.resume
    if (!resume || profile.extraction_status === 'ready' || profile.extraction_status === 'failed') return
    void act('Preparing your PDF for applications…', request => prepareSelected(resume.id, request), true)
  }
  const chooseResume = (id: string) => void act('Using your selected PDF…', async request => {
    const result = await updateAutofillDetails({ resume_id: id || null }, config(request))
    if (!current(request)) return
    setProfile(result.data)
    if (!id || result.data.resume?.id !== id) return
    if (result.data.extraction_status === 'ready') { setNotice('PDF selected. Saved answers are ready to reuse.'); return }
    if (result.data.extraction_status === 'failed') return
    await prepareSelected(id, request)
  }, true)
  const chooseField = (key: string) => { setEditKey(key); setEditValue(profile?.values[key] || '') }
  const saveDetail = () => {
    if (!editKey) return
    void act('Saving your detail…', async request => {
      const result = await updateAutofillDetails({ values: { [editKey]: editValue.trim() || null } }, config(request))
      if (current(request)) { setProfile(result.data); setNotice('Detail saved for future forms.'); setEditKey(''); setEditValue('') }
    })
  }
  const entries = autofillFields.map(([key]) => [key, profile?.values[key] || ''] as const).filter(([, value]) => value.trim())
  const missing = new Set(profile?.missing_fields || [])
  const availableResumes = profile?.resumes.filter(item => item.has_file !== false && item.sha256) || []
  return <section className="autofill-facts" aria-labelledby="autofill-facts-heading">
    <h2 id="autofill-facts-heading">Application answers</h2>
    <p>Your selected PDF supplies reusable facts. You only add what a form still needs.</p>
    {!profile && !error && <p role="status">Loading saved application answers…</p>}
    {profile && <>
      {availableResumes.length > 0 ? <>
        <label htmlFor="autofill-resume">Resume for autofill</label>
        <p className="autofill-facts-note">Choosing a PDF prepares its answers with AI if needed; a new analysis may be billed. Ready PDFs reuse saved answers.</p>
        <select id="autofill-resume" value={profile.resume?.id || ''} disabled={Boolean(busy) || pdfGate.busy} onChange={event => chooseResume(event.target.value)}>
          <option value="">Choose a saved PDF</option>
          {availableResumes.map(item => <option key={item.id} value={item.id}>{item.filename}{availableResumes.filter(other => other.filename === item.filename).length > 1 ? ` · ${item.id.slice(0, 8)}` : ''}</option>)}
        </select>
        {profile.requires_resume_selection && <p>Choose the PDF you want to use. No file is selected automatically when several are saved.</p>}
        <div className="autofill-facts-actions">
          {!['ready', 'failed'].includes(profile.extraction_status) && profile.resume && <button type="button" className="btn btn-primary" disabled={Boolean(busy) || pdfGate.busy} onClick={read}>{busy ? 'Using PDF…' : 'Use this PDF'}</button>}
          <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || pdfGate.busy} onClick={() => setRetry(value => value + 1)}>Refresh saved answers</button>
        </div>
        <p className="autofill-facts-note">Saved Profile answers take priority. Choosing a PDF does not send it to an employer or submit an application.</p>
      </> : <p>Upload your PDF above to prepare its answers. Your saved Profile answers remain available.</p>}
      {profile.extraction_status === 'failed' && <p role="alert">Your PDF is saved, but its answers could not be prepared. No automatic retry will run. Add missing details manually or choose another PDF.</p>}
      <p className="autofill-facts-ready">{entries.length} saved answers available{profile.extraction_status === 'ready' ? ' · PDF ready' : ''}.</p>
      {profile.review?.reviewed && <p className="autofill-facts-note">Facts reviewed against the PDF.</p>}
      {entries.length > 0 && <details>
        <summary>See saved answers and PDF evidence</summary>
        <dl className="autofill-facts-list">{entries.map(([key, value]) => <div key={key}>
          <dt>{labels[key] || key.replaceAll('_', ' ')} <span>{sourceLabels[profile.sources[key]?.source] || 'Saved answer'}</span></dt>
          <dd>{value}{profile.sources[key]?.quote && <blockquote>{profile.sources[key].quote}</blockquote>}</dd>
        </div>)}</dl>
      </details>}
      <details>
        <summary>Add a missing detail or correct an answer</summary>
        <p>Add only the details you need. A blank saved value stops PDF autofill for that detail. Existing Profile values are edited in the Profile form below.</p>
        <label htmlFor="autofill-detail-key">Detail</label>
        <select id="autofill-detail-key" value={editKey} disabled={Boolean(busy) || pdfGate.busy} onChange={event => chooseField(event.target.value)}>
          <option value="">Choose a detail</option>
          <optgroup label="Not yet saved">{autofillFields.filter(([key]) => missing.has(key) || !profile.values[key]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</optgroup>
          <optgroup label="Saved answers">{autofillFields.filter(([key]) => Boolean(profile.values[key]) && !missing.has(key)).map(([key, label]) => <option key={key} value={key} disabled={profile.sources[key]?.source === 'profile'}>{label}{profile.sources[key]?.source === 'profile' ? ' — edit in saved Profile' : ''}</option>)}</optgroup>
        </select>
        {editKey && <>
          <label htmlFor="autofill-detail-value">{labels[editKey] || editKey}</label>
          <textarea id="autofill-detail-value" value={editValue} maxLength={10000} disabled={Boolean(busy) || pdfGate.busy} onChange={event => setEditValue(event.target.value)} placeholder={editKey.endsWith('_date') ? 'YYYY-MM-DD' : undefined} />
          <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || pdfGate.busy} onClick={saveDetail}>Save this detail</button>
        </>}
      </details>
    </>}
    {busy && <p role="status">{busy}</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(busy) || pdfGate.busy} onClick={() => setRetry(value => value + 1)}>Refresh saved answers</button></div>}
  </section>
}
