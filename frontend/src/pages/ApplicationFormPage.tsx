import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'

const MOCK_FORM = {
  jobTitle: 'Software Engineer Intern',
  company: 'GovTech Singapore',
  fields: [
    { id: 1, label: 'Full Name', type: 'text', required: true, aiSuggestion: 'Tang Yuchen', confidence: 'high' },
    { id: 2, label: 'Email Address', type: 'email', required: true, aiSuggestion: 'yuchen.tang@example.com', confidence: 'high' },
    { id: 3, label: 'Phone Number', type: 'tel', required: true, aiSuggestion: '+65 9897 7897', confidence: 'high' },
    { id: 4, label: 'Nationality', type: 'text', required: true, aiSuggestion: 'Chinese', confidence: 'high' },
    { id: 5, label: 'Highest Qualification', type: 'text', required: true, aiSuggestion: 'Master in Software Engineering (NUS)', confidence: 'high' },
    { id: 6, label: 'Expected Graduation', type: 'text', required: true, aiSuggestion: '2027', confidence: 'high' },
    { id: 7, label: 'Availability / Start Date', type: 'text', required: true, aiSuggestion: 'February 2027', confidence: 'medium' },
    { id: 8, label: 'Why do you want to join GovTech?', type: 'textarea', required: true, aiSuggestion: 'I am passionate about leveraging technology for public good. GovTech\'s mission to build digital services for Singapore citizens aligns with my background in software engineering and my interest in impactful technology solutions.', confidence: 'medium' },
    { id: 9, label: 'Relevant Skills', type: 'text', required: true, aiSuggestion: 'Python, React, TypeScript, SQL, Data Analysis', confidence: 'high' },
    { id: 10, label: 'LinkedIn Profile URL', type: 'url', required: false, aiSuggestion: 'https://linkedin.com/in/yuchen-tang', confidence: 'high' },
    { id: 11, label: 'Expected Salary (SGD/month)', type: 'text', required: false, aiSuggestion: '$1200-1500', confidence: 'low' },
    { id: 12, label: 'Additional Information', type: 'textarea', required: false, aiSuggestion: '', confidence: 'low' },
  ]
}

type FieldStatus = 'pending' | 'confirmed' | 'edited'

const CONFIDENCE_CONFIG = {
  high: { color: '#34a853', label: 'High confidence', bg: '#f0fdf4' },
  medium: { color: '#f59e0b', label: 'Medium confidence', bg: '#fffbeb' },
  low: { color: '#dc2626', label: 'Low confidence — please review', bg: '#fef2f2' },
}

const ApplicationFormPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()

  const [values, setValues] = useState<Record<number, string>>(
    Object.fromEntries(MOCK_FORM.fields.map(f => [f.id, f.aiSuggestion]))
  )
  const [statuses, setStatuses] = useState<Record<number, FieldStatus>>(
    Object.fromEntries(MOCK_FORM.fields.map(f => [f.id, 'pending']))
  )
  const [submitted, setSubmitted] = useState(false)

  const confirm = (fieldId: number) => {
    setStatuses(s => ({ ...s, [fieldId]: 'confirmed' }))
  }

  const edit = (fieldId: number, value: string) => {
    setValues(v => ({ ...v, [fieldId]: value }))
    setStatuses(s => ({ ...s, [fieldId]: 'edited' }))
  }

  const requiredFields = MOCK_FORM.fields.filter(f => f.required)
  const allConfirmed = requiredFields.every(f => statuses[f.id] === 'confirmed' || statuses[f.id] === 'edited')
  const confirmedCount = MOCK_FORM.fields.filter(f => statuses[f.id] === 'confirmed' || statuses[f.id] === 'edited').length

  const handleSubmit = () => {
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
        <Navbar />
        <div style={{ maxWidth: '600px', margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '48px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
            <p style={{ fontSize: '64px', margin: '0 0 16px 0' }}>✅</p>
            <h2>Application Submitted!</h2>
            <p style={{ color: '#666' }}>Your application to <strong>{MOCK_FORM.company}</strong> for <strong>{MOCK_FORM.jobTitle}</strong> has been recorded.</p>
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
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo={`/jobs/${id}`} backLabel="← Back to Job" />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>

        {/* Header */}
        <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          <h2 style={{ margin: '0 0 4px 0' }}>AI-Assisted Application</h2>
          <p style={{ margin: '0 0 16px 0', color: '#666' }}>{MOCK_FORM.jobTitle} · {MOCK_FORM.company}</p>

          {/* Progress */}
          <div style={{ backgroundColor: '#f1f3f4', borderRadius: '4px', height: '8px', marginBottom: '8px' }}>
            <div style={{ backgroundColor: '#1a73e8', height: '8px', borderRadius: '4px', width: `${(confirmedCount / MOCK_FORM.fields.length) * 100}%`, transition: 'width 0.3s' }} />
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>
            {confirmedCount} / {MOCK_FORM.fields.length} fields confirmed
            {!allConfirmed && <span style={{ color: '#f59e0b', marginLeft: '8px' }}>· Please confirm all required fields to submit</span>}
          </p>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[
            { color: '#34a853', label: '✓ Confirmed' },
            { color: '#1a73e8', label: '✏️ Edited' },
            { color: '#f59e0b', label: '⚠ Pending review' },
          ].map(({ color, label }) => (
            <span key={label} style={{ fontSize: '13px', color }}>● {label}</span>
          ))}
        </div>

        {/* Form Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          {MOCK_FORM.fields.map(field => {
            const status = statuses[field.id]
            const conf = CONFIDENCE_CONFIG[field.confidence as keyof typeof CONFIDENCE_CONFIG]
            const isConfirmed = status === 'confirmed'
            const isEdited = status === 'edited'

            return (
              <div key={field.id} style={{
                backgroundColor: 'white', borderRadius: '8px', padding: '20px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                borderLeft: `4px solid ${isConfirmed ? '#34a853' : isEdited ? '#1a73e8' : conf.color}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontWeight: '500', fontSize: '14px' }}>{field.label}</span>
                    {field.required && <span style={{ color: '#dc2626', marginLeft: '4px' }}>*</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: conf.color, backgroundColor: conf.bg, padding: '2px 8px', borderRadius: '10px' }}>
                      {isConfirmed ? '✓ Confirmed' : isEdited ? '✏️ Edited' : conf.label}
                    </span>
                  </div>
                </div>

                {field.type === 'textarea' ? (
                  <textarea
                    value={values[field.id]}
                    onChange={e => edit(field.id, e.target.value)}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical', minHeight: '80px', backgroundColor: isConfirmed ? '#f0fdf4' : 'white' }}
                  />
                ) : (
                  <input
                    type={field.type}
                    value={values[field.id]}
                    onChange={e => edit(field.id, e.target.value)}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box', backgroundColor: isConfirmed ? '#f0fdf4' : 'white' }}
                  />
                )}

                {!isConfirmed && (
                  <button onClick={() => confirm(field.id)}
                    style={{ marginTop: '8px', padding: '4px 16px', backgroundColor: '#34a853', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
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
            By submitting, you confirm that all values above are accurate. The final submission is your action.
          </p>
          <button onClick={handleSubmit} disabled={!allConfirmed}
            style={{ padding: '12px 48px', backgroundColor: allConfirmed ? '#1a73e8' : '#ccc', color: 'white', border: 'none', borderRadius: '4px', cursor: allConfirmed ? 'pointer' : 'not-allowed', fontSize: '16px', fontWeight: '500' }}>
            Submit Application
          </button>
          {!allConfirmed && (
            <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#f59e0b' }}>
              Please confirm all required fields (*) before submitting
            </p>
          )}
        </div>

      </div>
    </div>
  )
}

export default ApplicationFormPage