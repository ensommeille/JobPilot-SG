import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import api from '../services/api'

// confidence 0-1 转换为显示级别
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

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        // Step 1: bootstrap → 找到这个 job 对应的 form
        const boot = await api.get('/assistant/bootstrap')
        const forms: Array<{ id: string; job_id: string }> = boot.data.forms ?? []
        const matched = forms.find(f => f.job_id === id)

        if (!matched) {
          setNoForm(true)
          setLoading(false)
          return
        }

        const fid = matched.id
        setFormId(fid)

        // Step 2: 获取 form 的 fields_json
        const formRes = await api.get(`/assistant/forms/${fid}`)
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

        // Step 3: map-fields（失败则字段留空，交由用户手填）
        let mapping: MappingField[] = []
        try {
          const mapRes = await api.post('/assistant/map-fields', {
            form_id: fid,
            form_snapshot: snapshot,
          })
          mapping = mapRes.data.mapping ?? []
          setMappingDraft(mapRes.data)
        } catch {
          mapping = []
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
        setLoadError('Failed to load the application form. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

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
    if (!formId || !mappingDraft) {
      setSubmitError('The live application form is unavailable. No application was recorded.')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const confirmedIds = fields
        .filter(f => statuses[f.field_id] === 'confirmed')
        .map(f => f.field_id)

      const editedValues: Record<string, string> = {}
      fields
        .filter(f => statuses[f.field_id] === 'edited')
        .forEach(f => { editedValues[f.field_id] = values[f.field_id] })

      await api.post('/assistant/applications', {
        job_id: id,
        form_id: formId,
        mapping_version: 'mapping-v1',
        provider: 'm4-mapping',
        prompt_version: 'form-mapping-v1',
        mapping_draft: mappingDraft,
        confirmed_field_ids: confirmedIds,
        edited_values: editedValues,
      })
      setSubmitted(true)
    } catch {
      setSubmitError('Your application could not be recorded. Please review the fields and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo={`/jobs/${id}`} backLabel="← Back to Job" />
      <p style={{ textAlign: 'center', marginTop: '80px', color: '#666' }}>
        AI is preparing your form...
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
        <p style={{ color: '#dc2626' }}>{loadError}</p>
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
          <h2>Application Submitted!</h2>
          <p style={{ color: '#666' }}>Your application has been recorded.</p>
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
          <div style={{ backgroundColor: '#f1f3f4', borderRadius: '4px', height: '8px', marginBottom: '8px' }}>
            <div style={{ backgroundColor: '#1a73e8', height: '8px', borderRadius: '4px',
              width: `${fields.length ? (confirmedCount / fields.length) * 100 : 0}%`,
              transition: 'width 0.3s' }} />
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
            {confirmedCount} / {fields.length} fields confirmed
            {!allConfirmed && <span style={{ color: '#f59e0b', marginLeft: '8px' }}>· Please confirm all required fields to submit</span>}
          </p>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[{ color: '#34a853', label: '✓ Confirmed' }, { color: '#1a73e8', label: '✏️ Edited' }, { color: '#f59e0b', label: '⚠ Pending review' }].map(({ color, label }) => (
            <span key={label} style={{ fontSize: '13px', color }}>● {label}</span>
          ))}
        </div>

        {/* Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
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
                  <span style={{ fontWeight: '500', fontSize: '14px' }}>
                    {field.label}
                    {field.required && <span style={{ color: '#dc2626', marginLeft: '4px' }}>*</span>}
                  </span>
                  <span style={{ fontSize: '11px', color: conf.color, backgroundColor: conf.bg, padding: '2px 8px', borderRadius: '10px' }}>
                    {isConfirmed ? '✓ Confirmed' : isEdited ? '✏️ Edited' : conf.label}
                  </span>
                </div>
                {field.type === 'textarea' ? (
                  <textarea value={values[field.field_id] ?? ''}
                    onChange={e => edit(field.field_id, e.target.value)}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px',
                      fontSize: '14px', boxSizing: 'border-box', resize: 'vertical', minHeight: '80px',
                      backgroundColor: isConfirmed ? '#f0fdf4' : 'white' }} />
                ) : (
                  <input type={field.type} value={values[field.field_id] ?? ''}
                    onChange={e => edit(field.field_id, e.target.value)}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px',
                      fontSize: '14px', boxSizing: 'border-box',
                      backgroundColor: isConfirmed ? '#f0fdf4' : 'white' }} />
                )}
                {!isConfirmed && !isEdited && (
                  <button onClick={() => confirm(field.field_id)} disabled={!values[field.field_id]?.trim()}
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
            By submitting, you confirm all values above are accurate.
          </p>
          <button onClick={handleSubmit} disabled={!allConfirmed || submitting}
            style={{ padding: '12px 48px', fontSize: '16px', fontWeight: '500', color: 'white', border: 'none', borderRadius: '4px',
              backgroundColor: allConfirmed && !submitting ? '#1a73e8' : '#ccc',
              cursor: allConfirmed && !submitting ? 'pointer' : 'not-allowed' }}>
            {submitting ? 'Submitting...' : 'Submit Application'}
          </button>
          {!allConfirmed && (
            <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#f59e0b' }}>
              Please confirm all required fields (*) before submitting
            </p>
          )}
          {submitError && <p role="alert" style={{ color: '#dc2626' }}>{submitError}</p>}
        </div>
      </div>
    </div>
  )
}

export default ApplicationFormPage
