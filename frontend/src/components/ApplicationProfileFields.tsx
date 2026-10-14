import { countries } from '../services/countries'

export interface ApplicationDetails {
  resume_summary: string
  availability_period: string
  nationality: string
  study_country: string
}

export default function ApplicationProfileFields({ value, onChange }: {
  value: ApplicationDetails
  onChange: (value: ApplicationDetails) => void
}) {
  const change = (key: keyof ApplicationDetails, text: string) => onChange({ ...value, [key]: text })
  const control = { width: '100%', boxSizing: 'border-box' as const, padding: '10px 12px', border: '1px solid #b8c7c3', borderRadius: 4, fontSize: 16, marginTop: 6 }
  return <section aria-labelledby="application-profile-heading" style={{ background: 'white', borderRadius: 8, padding: 24, marginBottom: 16 }}>
    <h2 id="application-profile-heading" style={{ marginTop: 0 }}>Reusable application details</h2>
    <p>Maintain these details once in JobPilot. They are saved to your account and reused across applications; review them before filling each form.</p>
    <label htmlFor="resume-summary">Personal introduction (written by you)</label>
    <textarea id="resume-summary" value={value.resume_summary} onChange={e => change('resume_summary', e.target.value)} maxLength={3000} rows={5} style={control} aria-describedby="summary-hint" />
    <p id="summary-hint" style={{ fontSize: 14 }}>Up to 3,000 characters. No AI generation. Leave blank to complete it separately for each application.</p>
    <label htmlFor="availability-period">Availability period</label>
    <input id="availability-period" value={value.availability_period} onChange={e => change('availability_period', e.target.value)} maxLength={500} style={control} placeholder="Your actual start and end dates" />
    {(['nationality', 'study_country'] as const).map(key => <div key={key} style={{ marginTop: 16 }}>
      <label htmlFor={key}>{key === 'nationality' ? 'Nationality' : 'Country of study / graduation'}</label>
      <select id={key} style={control} value={value[key]} onChange={e => change(key, e.target.value)}>
        <option value="">Not specified</option>
        {countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}
      </select>
    </div>)}
    <p style={{ fontSize: 14 }}>Country selections are never inferred. Saving your profile does not fill or submit any application.</p>
  </section>
}
