import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import api from '../services/api'
import { getToken } from '../services/auth'
import { countries } from '../services/countries'
import { extensionMessage } from '../services/extensionConnection'
import { applicationFields, draftFingerprint, parseApplicationReview, parseFillReport, parseSavedDraft,
  type ApplicationFieldId, type ApplicationValues, type CountryChoices,
  type FillReport, type SavedApplicationDraft } from '../services/applicationPreparation'
import InternSGApplication from './InternSGApplication'
import ExtensionStatus from './ExtensionStatus'
import './ApplicationPreparation.css'

export default function ApplicationPreparation({jobId, url, token}: {jobId: string; url: string; token: string}) {
  const [savedDraft, setSavedDraft] = useState<SavedApplicationDraft | null>(null)
  const [values, setValues] = useState<ApplicationValues>(() => Object.fromEntries(applicationFields.map(field => [field.id, ''])) as ApplicationValues)
  const [choices, setChoices] = useState<CountryChoices>({nationality: '', campus: ''})
  const [draftBusy, setDraftBusy] = useState(true)
  const [draftError, setDraftError] = useState('')
  const [operation, setOperation] = useState<'inspect' | 'fill' | null>(null)
  const [error, setError] = useState('')
  const [report, setReport] = useState<FillReport | null>(null)
  const [frameLoaded, setFrameLoaded] = useState(false)
  const [extensionConnected, setExtensionConnected] = useState(false)
  const [editingSaved, setEditingSaved] = useState(false)
  const alive = useRef(true)
  const generation = useRef(0)
  const busy = useRef(false)
  const filling = useRef(false)
  const draftRequest = useRef<AbortController | null>(null)
  const profileLink = '/profile?returnTo=' + encodeURIComponent(`/jobs/${jobId}/apply-external`)

  const loadDraft = useCallback(() => {
    if (busy.current || getToken() !== token) return
    draftRequest.current?.abort()
    const request = new AbortController()
    draftRequest.current = request
    return api.post('/browser-assistant/draft', {page_url: url, field_ids: applicationFields.map(field => field.id)},
        {signal: request.signal, timeout: 15000, headers: {Authorization: `Bearer ${token}`}})
      .then(response => {
      if (!alive.current || request.signal.aborted || getToken() !== token) return
      const draft = parseSavedDraft(response.data)
      setSavedDraft(draft); setValues(draft.values); setChoices(draft.countries)
    }).catch(err => {
      if (alive.current && !request.signal.aborted && getToken() === token) setDraftError(err instanceof Error && !('isAxiosError' in err)
        ? err.message : 'Could not load saved application details. Your account has not been changed. Try loading them again.')
    }).finally(() => { if (alive.current && draftRequest.current === request && !request.signal.aborted) setDraftBusy(false) })
  }, [token, url])

  function reloadDraft() {
    if (busy.current || getToken() !== token) return
    generation.current++
    setReport(null); setError('')
    setDraftBusy(true); setDraftError(''); setSavedDraft(null)
    setEditingSaved(false)
    setExtensionConnected(false)
    void loadDraft()
  }

  useEffect(() => {
    alive.current = true
    void loadDraft()
    return () => { alive.current = false; draftRequest.current?.abort() }
  }, [loadDraft])

  const frameChanged = useCallback((loaded: boolean) => {
    generation.current++
    setFrameLoaded(loaded); setReport(null)
    if (filling.current) setError('The original form navigated while filling. Some answers may already be filled; inspect the original page. No automatic retry or submission was made.')
    else if (busy.current) setError('The original form changed before filling. No answers were sent. Review it before trying again.')
  }, [])

  const validContext = (version: number) => alive.current && generation.current === version && getToken() === token
  const extensionId = () => {
    const id = localStorage.getItem('jobpilot_extension_id')
    if (!id || !/^[a-p]{32}$/.test(id)) throw new Error('Connect the JobPilot extension once using the setup instructions below, then try filling again.')
    return id
  }

  const handleFill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy.current || !savedDraft || draftBusy || !frameLoaded || !extensionConnected || getToken() !== token) return
    if (!event.currentTarget.reportValidity()) return
    // The explicit click approves this snapshot, never later edits or a stale review.
    const shown = {values: {...values}, countries: {...choices}}
    const version = ++generation.current
    let dispatched = false
    busy.current = true; setOperation('inspect'); setError(''); setReport(null)
    try {
      const id = extensionId()
      const fingerprint = await draftFingerprint(savedDraft)
      if (!validContext(version)) return
      const inspected = await extensionMessage(id, {kind: 'application-inspect', version: 1, job_id: jobId, page_url: url, profile_fingerprint: fingerprint})
      if (!validContext(version)) return
      const review = parseApplicationReview(inspected)
      const approved: {id: string; value: string; confirmed: true}[] = []
      const skipped: string[] = []
      const reasons: Record<string, string> = {}
      const skip = (field: string, reason: string) => { skipped.push(field); reasons[field] = reason }
      for (const field of applicationFields) {
        const value = shown.values[field.id]
        const observed = review.fields.find(item => item.id === field.id)
        if (!value.trim()) skip(field.id, 'No answer provided. Add it here or update your saved profile.')
        else if (!observed || observed.unavailable) skip(field.id, 'This field is missing, unavailable or unsupported. Complete it on the original form.')
        else if (observed.occupied) skip(field.id, 'The original form already has an answer. It was left unchanged.')
        else if (value.length > observed.maxLength) skip(field.id, `The original form allows ${observed.maxLength} characters. Shorten this answer before filling again.`)
        else approved.push({id: field.id, value, confirmed: true})
      }
      const pair = shown.countries
      if (!pair.nationality || !pair.campus) skip('applicant_countries', 'Both nationality and study country are needed. Existing country choices were left unchanged.')
      else if (!review.countries_available) skip('applicant_countries', review.country_reason || 'Country controls are unavailable. Select your countries on the original form.')
      else if (![pair.nationality, pair.campus].every(code => review.countries.some(country => country.code === code))) {
        skip('applicant_countries', 'These countries are not both supported by the original form. Select them on the original site.')
      } else approved.push({id: 'applicant_countries', value: JSON.stringify(pair), confirmed: true})
      if (!approved.length) { setReport({filled: [], skipped, reasons}); return }
      if (!validContext(version)) return
      if (extensionId() !== id) throw new Error('The extension connection changed. Reconnect and try again.')
      filling.current = true; dispatched = true; setOperation('fill')
      const result = await extensionMessage(id, {kind: 'application-fill', version: 1, job_id: jobId, page_url: url,
        review_id: review.review_id, approved})
      if (!validContext(version)) return
      const filled = parseFillReport(result, approved.map(item => item.id))
      setReport({filled: filled.filled, skipped: [...skipped, ...filled.skipped], reasons: {...reasons, ...filled.reasons}})
    } catch (err) {
      if (validContext(version)) setError((err instanceof Error ? err.message : 'Could not fill this form.')
        + (dispatched ? ' Some answers may already be filled. Check the original form before trying again. No automatic retry or submission was made.' : ' No answers were sent.'))
    } finally { busy.current = false; filling.current = false; if (alive.current) setOperation(null) }
  }

  function changeValue(id: ApplicationFieldId, value: string) {
    setValues(previous => ({...previous, [id]: value})); setReport(null)
  }
  function fieldReason(id: ApplicationFieldId) {
    if (report?.filled.includes(id)) return 'Filled. Check the answer on the original form.'
    if (report?.skipped.includes(id)) return report.reasons[id]
    if (!values[id].trim()) return 'No saved answer. Add one here for this application, or update your profile to reuse it.'
    return null
  }
  const missingCount = applicationFields.filter(field => !values[field.id].trim()).length
    + Number(!choices.nationality) + Number(!choices.campus)

  const hasMissingSavedAnswers = savedDraft && (applicationFields.some(field => !savedDraft.values[field.id].trim()) || !savedDraft.countries.nationality || !savedDraft.countries.campus)
  const fillState = operation === 'inspect' ? 'Checking the original form…' : operation === 'fill' ? 'Filling approved answers…'
    : !frameLoaded ? 'Waiting for the original form to load.' : !extensionConnected ? 'Connect this account’s extension to fill supported fields.'
      : draftBusy ? 'Loading saved details…' : 'Ready to fill your saved details.'

  return <div className="application-preparation">
    <section className="application-review" aria-labelledby="application-review-title" aria-busy={draftBusy}>
      <header className="preparation-summary">
        <h2 id="application-review-title">Your application details</h2>
        {savedDraft && <p role="status">{missingCount ? `${7 - missingCount} saved details loaded; ${missingCount} need your input.` : 'All seven saved details are loaded.'} No need to type them again.</p>}
      </header>
      {draftBusy && <p role="status" className="preparation-loading">Loading your saved application details…</p>}
      {draftError && <p role="alert" className="alert alert-error">{draftError} <button type="button" className="link" onClick={() => void reloadDraft()}>Reload saved details</button></p>}
      {savedDraft && <>
        <details className="preparation-saved-details"><summary>Review the details already loaded</summary><dl>{applicationFields.filter(field => values[field.id].trim()).map(field => <div key={field.id}><dt>{field.label}</dt><dd>{values[field.id]}</dd></div>)}{(['nationality', 'campus'] as const).filter(key => choices[key]).map(key => <div key={key}><dt>{key === 'nationality' ? 'Nationality' : 'Country of study / graduation'}</dt><dd>{countries.find(country => country.code === choices[key])?.name || choices[key]}</dd></div>)}</dl>
          <div className="preparation-actions"><Link to={profileLink}>Update my saved profile</Link><button type="button" className="link" disabled={draftBusy || !!operation} onClick={() => void reloadDraft()}>Reload saved details</button></div>
          <p className="muted preparation-hint">Reloading replaces one-off edits. Edits below apply only to this application.</p>
        </details>
        <button type="button" className="link preparation-edit" disabled={!!operation} onClick={() => setEditingSaved(value => !value)}>{editingSaved ? 'Show only missing answers' : 'Edit loaded answers for this application'}</button>
        <form id="jobpilot-application-review" noValidate onSubmit={handleFill}>
          {(editingSaved || hasMissingSavedAnswers) && <fieldset disabled={!!operation || draftBusy} className="preparation-fields">
            <legend className="preparation-legend">{editingSaved ? 'Application answers' : 'Complete missing answers'}</legend>
            {applicationFields.filter(field => editingSaved || !savedDraft.values[field.id].trim()).map(field => <div className={'preparation-field' + (field.id === 'applicant_summary' ? ' preparation-field-wide' : '')} key={field.id}>
              <label htmlFor={'review-' + field.id}>{field.label}</label>
              {field.id === 'applicant_summary'
                ? <textarea id={'review-' + field.id} rows={5} value={values[field.id]} maxLength={field.maxLength} onChange={event => changeValue(field.id, event.target.value)} aria-describedby={fieldReason(field.id) ? field.id + '-reason' : undefined} />
                : <input id={'review-' + field.id} type={field.id === 'applicant_email' ? 'email' : field.id === 'applicant_contact' ? 'tel' : 'text'}
                    value={values[field.id]} maxLength={field.maxLength} onChange={event => changeValue(field.id, event.target.value)} aria-describedby={fieldReason(field.id) ? field.id + '-reason' : undefined} />}
              {fieldReason(field.id) && <p className="muted preparation-hint" id={field.id + '-reason'}>{fieldReason(field.id)}</p>}
            </div>)}
            {(['nationality', 'campus'] as const).filter(key => editingSaved || !savedDraft.countries[key]).map(key => <div className="preparation-field" key={key}>
              <label htmlFor={'review-country-' + key}>{key === 'nationality' ? 'Nationality' : 'Country of study / graduation'}</label>
              <select id={'review-country-' + key} value={choices[key]} onChange={event => { setChoices(previous => ({...previous, [key]: event.target.value})); setReport(null) }}>
                <option value="">Not specified</option>{countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
              </select>
            </div>)}
            {report?.skipped.includes('applicant_countries') && <p className="preparation-field-wide preparation-hint">{report.reasons.applicant_countries}</p>}
          </fieldset>}
        </form>
      </>}
    </section>
    <InternSGApplication url={url} platformManaged onFrameChange={frameChanged} controls={savedDraft && <div className="preparation-fill-controls">
      <ExtensionStatus token={token} onConnectionChange={setExtensionConnected} />
      <div className="preparation-actions">
        {frameLoaded && <button type="submit" form="jobpilot-application-review" className="btn btn-primary" aria-describedby="fill-permission fill-readiness" disabled={!!operation || draftBusy || !extensionConnected}>
          {operation === 'inspect' ? 'Checking original form…' : operation === 'fill' ? 'Filling application form…' : 'Fill application form'}</button>}
        <span id="fill-readiness" role="status">{fillState}</span>
      </div>
      <p id="fill-permission" className="preparation-hint muted">Clicking Fill approves these answers, including your nationality and study-country choices. Existing text stays unchanged. PDF upload, CAPTCHA and final submission are yours.</p>
      {error && <p role="alert" className="alert alert-error">{error}</p>}
      {report && <div className="preparation-result" role="status">
        <p><strong>Filled {report.filled.length}; skipped {report.skipped.length}. Nothing was submitted.</strong></p>
        {report.skipped.length > 0 && <ul>{report.skipped.map(id => <li key={id}>{applicationFields.find(field => field.id === id)?.label || 'Nationality / study country'}: {report.reasons[id]}</li>)}</ul>}
        <p>Check the original form below. This is not an employer delivery receipt.</p>
      </div>}
    </div>} />
    <details className="preparation-setup"><summary>Connection and filling help</summary>
      <ol><li>Use Chrome with the updated JobPilot extension.</li><li>Choose Connect through JobPilot in the extension and confirm this same account.</li><li>Enable embedded InternSG access in its popup, then return here.</li></ol>
      <p>Unsupported fields stay manual. Reload saved details after profile changes. Nothing is filled or submitted automatically.</p>
    </details>
  </div>
}
