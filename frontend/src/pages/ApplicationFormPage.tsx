import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import api from '../services/api'
import { getToken, watchSession } from '../services/auth'

// Confidence is a review hint, not verified accuracy.
const getConfLevel = (confidence: number, needsReview: boolean): 'high' | 'medium' | 'low' => {
  if (needsReview || confidence < 0.5) return confidence < 0.5 ? 'low' : 'medium'
  if (confidence >= 0.8) return 'high'
  return 'medium'
}

const CONF = {
  high:   { color: '#34a853', label: 'High confidence',            bg: '#f0fdf4' },
  medium: { color: '#f59e0b', label: 'Medium confidence — review', bg: '#fffbeb' },
  low:    { color: '#dc2626', label: 'Low confidence — verify',    bg: '#fef2f2' },
}
const EDITABLE_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'url', 'number', 'date'])

type Status = 'pending' | 'confirmed' | 'edited'

interface Field {
  field_id: string; label: string; type: string
  required: boolean; confLevel: 'high' | 'medium' | 'low'
}

interface SnapshotField {
  field_id: string; label: string; type: string; required: boolean
  name?: string | null; options?: string[]; placeholder?: string | null; context?: string | null
}

interface MappingField {
  field_id: string; value: unknown; confidence: number; needs_review: boolean
}

const ApplicationFormPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()

  const [fields, setFields] = useState<Field[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [statuses, setStatuses] = useState<Record<string, Status>>({})
  const [formId, setFormId] = useState<string | null>(null)
  const [mappingDraft, setMappingDraft] = useState<object | null>(null)
  const [loading, setLoading] = useState(true)
  const [noForm, setNoForm] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [mappingNotice, setMappingNotice] = useState('')
  const [sessionToken, setSessionToken] = useState(getToken)
  const active = useRef<{jobId: string | undefined; token: string | null; controller: AbortController} | null>(null)
  const answerFields = useRef<HTMLDivElement>(null)

  useEffect(() => watchSession(() => {
    active.current?.controller.abort()
    setFields([])
    setValues({})
    setStatuses({})
    setMappingDraft(null)
    setSubmitted(false)
    setSessionToken(getToken())
  }), [])

  useEffect(() => {
    const context = {jobId: id, token: sessionToken, controller: new AbortController()}
    active.current = context
    const current = () => active.current === context && !context.controller.signal.aborted && getToken() === context.token
    const config = {signal: context.controller.signal, timeout: 15000, headers: {Authorization: `Bearer ${sessionToken}`}}
    const load = async () => {
      setLoading(true)
      setNoForm(false)
      setLoadError('')
      setSubmitError(null)
      setSubmitted(false)
      setSubmitting(false)
      setMappingNotice('')
      setFormId(null)
      setMappingDraft(null)
      setFields([])
      setValues({})
      setStatuses({})
      if (!sessionToken) {
        setLoadError('Sign in on JobPilot, then reopen this application form.')
        setLoading(false)
        return
      }
      try {
        const boot = await api.get('/assistant/bootstrap', config)
        if (!current()) return
        const forms: Array<{ id: string; job_id: string }> = boot.data.forms ?? []
        const matched = forms.find(f => f.job_id === id)

        if (!matched) {
          setNoForm(true)
          setLoading(false)
          return
        }

        const fid = matched.id
        setFormId(fid)

        const formRes = await api.get(`/assistant/forms/${fid}`, config)
        if (!current()) return
        const rawFields = formRes.data.fields_json ?? []
        const snapshot: SnapshotField[] = rawFields.map((f: Record<string, unknown>, i: number) => ({
          field_id: String(f.field_id ?? f.id ?? `f${i}`),
          label: String(f.label ?? ''),
          type: String(f.type ?? f.field_type ?? 'text'),
          required: Boolean(f.required ?? false),
          name: typeof f.name === 'string' ? f.name : null,
          options: Array.isArray(f.options) ? f.options.filter((option): option is string => typeof option === 'string') : [],
          placeholder: typeof f.placeholder === 'string' ? f.placeholder : null,
          context: typeof f.context === 'string' ? f.context : null,
        }))
        if (snapshot.some(field => !EDITABLE_TYPES.has(field.type) || Boolean(field.options?.length))) {
          setLoadError('This configured form uses fields this page cannot safely edit. Return to the job and follow the original application instructions. No application record has been saved.')
          return
        }

        // A manual draft uses the same existing contract if mapping is unavailable.
        let mapping: MappingField[] = []
        try {
          const mapRes = await api.post('/assistant/map-fields', {
            form_id: fid,
            form_snapshot: snapshot,
          }, {...config, timeout: 60000})
          if (!current()) return
          mapping = mapRes.data.mapping ?? []
          setMappingDraft(mapRes.data)
        } catch (error) {
          if (!current()) return
          if (axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)) throw error
          mapping = []
          setMappingDraft({mapping: [], unmapped_fields: snapshot.map(field => field.field_id), missing_profile_fields: []})
          setMappingNotice('Profile suggestions are unavailable. Enter and review the fields manually; you can still save a JobPilot application record.')
        }

        const valueMap: Record<string, string> = {}
        const confMap: Record<string, 'high' | 'medium' | 'low'> = {}
        mapping.forEach((m: MappingField) => {
          valueMap[m.field_id] = String(m.value ?? '')
          confMap[m.field_id] = getConfLevel(m.confidence, m.needs_review)
        })

        const displayFields: Field[] = snapshot.map(f => ({
          field_id: f.field_id, label: f.label,
          type: f.type, required: f.required,
          confLevel: confMap[f.field_id] ?? 'low',
        }))

        setFields(displayFields)
        setValues(valueMap)
        setStatuses(Object.fromEntries(displayFields.map(f => [f.field_id, 'pending' as Status])))
      } catch {
        if (!current()) return
        setLoadError('Failed to load the application form. Please try again.')
      } finally {
        if (current()) setLoading(false)
      }
    }
    load()
    return () => context.controller.abort()
  }, [id, sessionToken])

  const confirm = (fid: string) => {
    if (!values[fid]?.trim()) return
    setStatuses(s => ({ ...s, [fid]: 'confirmed' }))
  }

  const edit = (fid: string, value: string) => {
    setValues(v => ({ ...v, [fid]: value }))
    setStatuses(s => ({ ...s, [fid]: 'edited' }))
  }

  const requiredFields = fields.filter(f => f.required)
  const allConfirmed = requiredFields.every(f =>
    Boolean(values[f.field_id]?.trim()) && (statuses[f.field_id] === 'confirmed' || statuses[f.field_id] === 'edited')
  )
  const confirmedCount = fields.filter(f => statuses[f.field_id] === 'confirmed' || statuses[f.field_id] === 'edited').length

  const handleSubmit = async () => {
    const context = active.current
    const current = () => context !== null && active.current === context && !context.controller.signal.aborted && getToken() === context.token && context.jobId === id
    if (!context || !current() || submitting || !allConfirmed) return
    if (!answerFields.current) return
    const invalid = Array.from(answerFields.current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
      .find(field => !field.checkValidity())
    if (invalid) {
      invalid.reportValidity()
      setSubmitError('Check the highlighted answer and use the requested format. Your answers are kept; no record has been saved.')
      return
    }
    if (!formId || !mappingDraft) {
      setSubmitError('The live application form is unavailable. No application was recorded.')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const confirmedIds = fields
        .filter(f => Boolean(values[f.field_id]?.trim()) && ['confirmed', 'edited'].includes(statuses[f.field_id]))
        .map(f => f.field_id)
      if (!confirmedIds.length) {
        setSubmitError('Enter and review at least one answer before saving a record.')
        return
      }

      const editedValues: Record<string, string> = {}
      fields
        .filter(f => statuses[f.field_id] === 'edited')
        .forEach(f => { editedValues[f.field_id] = values[f.field_id] })

      await api.post('/assistant/applications', {
        job_id: id,
        form_id: formId,
        mapping_version: 'mapping-v1',
        provider: mappingNotice ? 'manual-fallback' : 'm4-mapping',
        prompt_version: mappingNotice ? 'manual-v1' : 'form-mapping-v1',
        mapping_draft: mappingDraft,
        confirmed_field_ids: confirmedIds,
        edited_values: editedValues,
      }, {signal: context.controller.signal, timeout: 15000, headers: {Authorization: `Bearer ${context.token}`}})
      if (current()) setSubmitted(true)
    } catch {
      if (current()) setSubmitError('The save could not be confirmed. Check My Applications before retrying to avoid a duplicate record; your answers remain here.')
    } finally {
      if (current()) setSubmitting(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo={`/jobs/${id}`} backLabel="← Back to Job" />
      <p style={{ textAlign: 'center', marginTop: '80px', color: '#666' }}>
        Loading the form and your saved profile suggestions...
      </p>
    </div>
  )

  if (noForm) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo={`/jobs/${id}`} backLabel="← Back to Job" />
      <div style={{ maxWidth: '600px', margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '48px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '48px', margin: '0 0 16px 0' }}>📝</p>
          <h2>Application not available yet</h2>
          <p style={{ color: '#666' }}>This role has no application form configured yet. Please check back later or apply through the original posting.</p>
          <button onClick={() => navigate(`/jobs/${id}`)}
            style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8',
              color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Back to Job
          </button>
        </div>
      </div>
    </div>
  )

  if (loadError) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo={`/jobs/${id}`} backLabel="← Back to Job" />
      <div style={{ textAlign: 'center', marginTop: '80px' }}>
        <p role="alert" style={{ color: '#dc2626', maxWidth: '65ch', margin: '0 auto', padding: '0 24px' }}>{loadError}</p>
        <button onClick={() => navigate(`/jobs/${id}`)}
          style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8',
            color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Back to Job
        </button>
      </div>
    </div>
  )

  if (submitted) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '600px', margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '48px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          <p style={{ fontSize: '64px', margin: '0 0 16px 0' }}>✅</p>
          <h2>Application record saved</h2>
          <p style={{ color: '#666' }}>Your reviewed answers are saved in JobPilot. This does not send an application to an employer or confirm delivery.</p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '24px' }}>
            <button onClick={() => navigate('/applications')}
              style={{ padding: '10px 24px', border: '1px solid #1a73e8', color: '#1a73e8', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer' }}>
              View My Applications
            </button>
            <button onClick={() => navigate('/jobs')}
              style={{ padding: '10px 24px', backgroundColor: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Browse More Jobs
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo={`/jobs/${id}`} backLabel="← Back to Job" />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>

        {/* Header */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          <h2 style={{ margin: '0 0 4px 0' }}>AI-Assisted Application</h2>
          <p style={{ color: '#666' }}>This configured form saves a JobPilot application record only. It does not submit to the original employer.</p>
          {mappingNotice && <p role="status">{mappingNotice}</p>}
          <div style={{ backgroundColor: '#f1f3f4', borderRadius: '4px', height: '8px', marginBottom: '8px' }}>
            <div style={{ backgroundColor: '#1a73e8', height: '8px', borderRadius: '4px',
              width: `${fields.length ? (confirmedCount / fields.length) * 100 : 0}%`,
              transition: 'width 0.3s' }} />
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
            {confirmedCount} / {fields.length} fields confirmed
            {!allConfirmed && <span style={{ color: '#f59e0b', marginLeft: '8px' }}>· Please confirm all required fields to save</span>}
          </p>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[{ color: '#34a853', label: '✓ Confirmed' }, { color: '#1a73e8', label: '✏️ Edited' }, { color: '#f59e0b', label: '⚠ Pending review' }].map(({ color, label }) => (
            <span key={label} style={{ fontSize: '13px', color }}>● {label}</span>
          ))}
        </div>

        {/* Fields */}
        <div ref={answerFields} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          {fields.map(field => {
            const status = statuses[field.field_id]
            const conf = CONF[field.confLevel]
            const isConfirmed = status === 'confirmed'
            const isEdited = status === 'edited'
            return (
              <div key={field.field_id} style={{ backgroundColor: 'white', borderRadius: '8px', padding: '20px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                borderLeft: `4px solid ${isConfirmed ? '#34a853' : isEdited ? '#1a73e8' : conf.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <label htmlFor={`application-${field.field_id}`} style={{ fontWeight: '500', fontSize: '14px' }}>
                    {field.label}
                    {field.required && <span style={{ color: '#dc2626', marginLeft: '4px' }}>*</span>}
                  </label>
                  <span style={{ fontSize: '11px', color: conf.color, backgroundColor: conf.bg, padding: '2px 8px', borderRadius: '10px' }}>
                    {isConfirmed ? '✓ Confirmed' : isEdited ? '✏️ Edited' : conf.label}
                  </span>
                </div>
                {field.type === 'textarea' ? (
                  <textarea id={`application-${field.field_id}`} required={field.required} disabled={submitting} value={values[field.field_id] ?? ''}
                    onChange={e => edit(field.field_id, e.target.value)}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px',
                      fontSize: '14px', boxSizing: 'border-box', resize: 'vertical', minHeight: '80px',
                      backgroundColor: isConfirmed ? '#f0fdf4' : 'white' }} />
                ) : (
                  <input id={`application-${field.field_id}`} required={field.required} disabled={submitting} type={field.type} value={values[field.field_id] ?? ''}
                    onChange={e => edit(field.field_id, e.target.value)}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px',
                      fontSize: '14px', boxSizing: 'border-box',
                      backgroundColor: isConfirmed ? '#f0fdf4' : 'white' }} />
                )}
                {!isConfirmed && !isEdited && (
                  <button onClick={() => confirm(field.field_id)} disabled={submitting || !values[field.field_id]?.trim()}
                    style={{ marginTop: '8px', padding: '4px 16px', backgroundColor: '#34a853',
                      color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
                    ✓ Confirm this field
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Submit */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <p style={{ margin: '0 0 16px 0', color: '#666', fontSize: '14px' }}>
            By saving, you confirm the reviewed answers are accurate. Nothing is sent to an employer.
          </p>
          <button onClick={handleSubmit} disabled={!allConfirmed || submitting}
            style={{ padding: '12px 48px', fontSize: '16px', fontWeight: '500', color: 'white', border: 'none', borderRadius: '4px',
              backgroundColor: allConfirmed && !submitting ? '#1a73e8' : '#ccc',
              cursor: allConfirmed && !submitting ? 'pointer' : 'not-allowed' }}>
            {submitting ? 'Saving record...' : 'Save application record'}
          </button>
          {!allConfirmed && (
            <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#f59e0b' }}>
              Please confirm all required fields (*) before saving
            </p>
          )}
          {submitError && <p role="alert" style={{ color: '#dc2626' }}>{submitError}</p>}
        </div>
      </div>
    </div>
  )
}

export default ApplicationFormPage
