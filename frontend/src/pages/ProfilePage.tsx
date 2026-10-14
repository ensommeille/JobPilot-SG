import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchProfile, updateProfile } from '../services/profile'
import ApplicationProfileFields, { type ApplicationDetails } from '../components/ApplicationProfileFields'
import { getToken, watchSession } from '../services/auth'

const SKILL_CATEGORIES: Record<string, string[]> = {
  'Programming Languages': ['Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'R', 'SQL', 'MATLAB', 'Go', 'Swift', 'Kotlin', 'PHP', 'Ruby', 'Scala', 'HTML/CSS', 'Bash/Shell'],
  'Frameworks & Libraries': ['React', 'Vue.js', 'Angular', 'Node.js', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'scikit-learn', 'Express.js'],
  'Tools & Platforms': ['Git', 'Docker', 'Kubernetes', 'AWS', 'Microsoft Azure', 'Google Cloud', 'Linux', 'Jira', 'Confluence', 'Figma', 'Tableau', 'Power BI', 'Salesforce', 'Bloomberg Terminal'],
  'Data & Analytics': ['Data Analysis', 'Machine Learning', 'Deep Learning', 'NLP', 'Data Visualization', 'Statistical Analysis', 'ETL', 'A/B Testing'],
  'Finance & Business': ['Financial Modeling', 'Valuation', 'Risk Analysis', 'VBA/Macros', 'Financial Analysis', 'Investment Analysis', 'CRM', 'Excel (Advanced)'],
  'Design': ['UI/UX Design', 'Adobe Photoshop', 'Adobe Illustrator', 'Figma', 'Wireframing'],
  'Soft Skills': ['Project Management', 'Agile/Scrum', 'Leadership', 'Communication', 'Critical Thinking', 'Problem Solving'],
}

const sectionStyle = { backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', padding: '24px', marginBottom: '16px' }
const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' as const, marginBottom: '8px' }
const labelStyle = { fontSize: '13px', color: '#666', marginBottom: '4px', display: 'block' as const }

const SkillSelector = ({ selected, onChange }: { selected: string[], onChange: (s: string[]) => void }) => {
  const [search, setSearch] = useState('')
  const [customSkill, setCustomSkill] = useState('')
  const [openCat, setOpenCat] = useState<string | null>(null)
  const toggle = (skill: string) => { if (selected.includes(skill)) onChange(selected.filter(s => s !== skill)); else if (selected.length < 100) onChange([...selected, skill]) }
  const addCustom = () => { const s = customSkill.trim(); if (s && s.length <= 100 && selected.length < 100 && !selected.includes(s)) onChange([...selected, s]); setCustomSkill('') }
  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {selected.map(s => (
            <span key={s} style={{ backgroundColor: '#e8f0fe', color: '#1a73e8', padding: '4px 12px', borderRadius: '16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {s}<button type="button" aria-label={`Remove skill ${s}`} onClick={() => toggle(s)} style={{ cursor: 'pointer', color: '#555', background: 'none', border: 0, fontWeight: 'bold' }}>×</button>
            </span>
          ))}
        </div>
      )}
      <input aria-label="Search skills" placeholder="Search skills..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: '8px' }} />
      <div style={{ border: '1px solid #ddd', borderRadius: '4px', maxHeight: '220px', overflowY: 'auto' }}>
        {Object.entries(SKILL_CATEGORIES).map(([cat, skills]) => {
          const filtered = skills.filter(s => s.toLowerCase().includes(search.toLowerCase()))
          if (search && filtered.length === 0) return null
          return (
            <div key={cat}>
              <button type="button" aria-expanded={openCat === cat || search !== ''} onClick={() => setOpenCat(openCat === cat ? null : cat)}
                style={{ width: '100%', border: 0, padding: '8px 12px', backgroundColor: '#f8f9fa', cursor: 'pointer', fontWeight: '500', fontSize: '13px', color: '#444', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', userSelect: 'none' as const }}>
                <span>{cat}</span><span>{openCat === cat ? '▲' : '▼'}</span>
              </button>
              {(openCat === cat || search !== '') && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 12px' }}>
                  {filtered.filter(s => !selected.includes(s)).map(skill => (
                    <button type="button" key={skill} disabled={selected.length >= 100} onClick={() => toggle(skill)}
                      style={{ backgroundColor: '#f1f3f4', color: '#444', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', cursor: 'pointer', border: '1px solid #e0e0e0' }}>
                      + {skill}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <input aria-label="Custom skill" maxLength={100} placeholder="Add custom skill (Enter)" value={customSkill} onChange={e => setCustomSkill(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }} />
        <button type="button" disabled={selected.length >= 100} onClick={addCustom} style={{ padding: '8px 16px', backgroundColor: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Add</button>
      </div>
    </div>
  )
}

interface LinkItem { label: string; url: string }

const ProfilePage = () => {
  const loadedToken = useRef<string | null>(null)
  const pending = useRef<AbortController | null>(null)
  const savingRef = useRef(false)
  const form = useRef<HTMLFormElement>(null)
  const [loading, setLoading] = useState(() => !!getToken())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(() => getToken() ? '' : 'Sign in to JobPilot, then reload your profile.')
  const [loadFailed, setLoadFailed] = useState(() => !getToken())
  const [applicationDetails, setApplicationDetails] = useState<ApplicationDetails>({
    resume_summary: '', availability_period: '', nationality: '', study_country: '',
  })

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [education, setEducation] = useState('')
  const [experience, setExperience] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [links, setLinks] = useState<LinkItem[]>([])

  useEffect(() => {
    const token = getToken()
    const request = new AbortController()
    pending.current = request
    loadedToken.current = token
    const invalidate = () => {
      pending.current?.abort(); loadedToken.current = null; savingRef.current = false
      setFullName(''); setPhone(''); setContactEmail(''); setEducation(''); setExperience('')
      setSkills([]); setLinks([])
      setApplicationDetails({resume_summary: '', availability_period: '', nationality: '', study_country: ''})
      setSaved(false); setSaving(false); setLoading(false); setLoadFailed(true)
      setError('Account changed. Reload your profile before editing or saving.')
    }
    const unwatch = watchSession(invalidate)
    if (!token) {
      return () => { request.abort(); unwatch() }
    }
    fetchProfile({signal: request.signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000})
      .then(res => {
        if (request.signal.aborted) return
        if (getToken() !== token) { invalidate(); return }
        const d = res.data
        if (!['resume_summary', 'availability_period', 'nationality', 'study_country'].every(key => key in d)) {
          throw new Error('Profile backend upgrade required')
        }
        setFullName(d.full_name ?? '')
        setPhone(d.phone ?? '')
        setContactEmail(d.contact_email ?? '')
        setEducation(d.education ?? '')
        setExperience(d.experience ?? '')
        setSkills(d.skills ?? [])
        setLinks(Object.entries(d.links ?? {}).map(([label, url]) => ({ label, url: String(url) })))
        setApplicationDetails({
          resume_summary: d.resume_summary ?? '', availability_period: d.availability_period ?? '',
          nationality: d.nationality ?? '', study_country: d.study_country ?? '',
        })
      })
      .catch(() => { if (!request.signal.aborted) { setLoadFailed(true); setError('Could not load the updated profile. Check the backend upgrade, then reload before editing to protect saved details.') } })
      .finally(() => { if (!request.signal.aborted) setLoading(false) })
    return () => { pending.current?.abort(); unwatch() }
  }, [])

  const save = async () => {
    if (loadFailed || savingRef.current || loading || !form.current?.reportValidity()) return
    const token = loadedToken.current
    if (!token || getToken() !== token) { setLoadFailed(true); setSaved(false); setError('Account changed. Reload your profile before editing or saving.'); return }
    const usableLinks = links.filter(l => l.label.trim() || l.url.trim())
    if (usableLinks.some(l => !l.label.trim() || !/^https?:\/\//i.test(l.url.trim())) || new Set(usableLinks.map(l => l.label.trim())).size !== usableLinks.length) {
      setSaved(false); setError('Links need a unique label and a complete HTTP or HTTPS URL. Your edits are kept.'); return
    }
    const request = new AbortController()
    pending.current = request
    savingRef.current = true
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      await updateProfile({
        ...Object.fromEntries(Object.entries(applicationDetails).map(([key, value]) => [key, value.trim() || null])),
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        contact_email: contactEmail.trim() || null,
        education: education.trim() || null,
        experience: experience.trim() || null,
        skills,
        links: Object.fromEntries(usableLinks.map(l => [l.label.trim(), l.url.trim()])),
      }, {signal: request.signal, headers: {Authorization: `Bearer ${token}`}, timeout: 15000})
      if (request.signal.aborted || getToken() !== token) return
      setSaved(true)
    } catch (error) {
      if (request.signal.aborted || getToken() !== token) return
      if (axios.isAxiosError(error) && error.response?.status === 422) {
        const details = error.response.data?.detail
        const fields = Array.isArray(details) ? [...new Set(details.map(item => Array.isArray(item.loc) ? String(item.loc[1] ?? 'profile').replaceAll('_', ' ') : 'profile'))].join(', ') : 'profile fields'
        setError(`Check ${fields}: one or more values are invalid or too long. Your edits are kept.`)
      } else setError('Failed to save your profile. Your edits are kept; check your connection and retry.')
    } finally {
      if (pending.current === request) { savingRef.current = false; setSaving(false) }
    }
  }

  const setLink = (i: number, patch: Partial<LinkItem>) => {
    setSaved(false)
    setLinks(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  if (loading) return (
    <div className="profile-page" style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <p style={{ textAlign: 'center', marginTop: '80px', color: '#666' }}>Loading profile...</p>
    </div>
  )

  return (
    <div className="profile-page" style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '720px', margin: '32px auto', padding: '0 24px' }}>

        {loadFailed && <p role="alert">{error} <button onClick={() => window.location.reload()}>Reload profile</button></p>}
        <form ref={form} onSubmit={event => { event.preventDefault(); void save() }}>
        <fieldset disabled={loading || saving || loadFailed} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} onChange={() => setSaved(false)}>

        {/* Personal */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Personal Information</h2>
          <div><label htmlFor="full-name" style={labelStyle}>Full Name</label><input id="full-name" maxLength={200} style={inputStyle} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" /></div>
          <div><label htmlFor="contact-email" style={labelStyle}>Contact Email</label><input id="contact-email" type="email" maxLength={320} style={inputStyle} value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></div>
          <div><label htmlFor="phone" style={labelStyle}>Phone</label><input id="phone" type="tel" maxLength={40} style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+65 ..." /></div>
        </div>

        <ApplicationProfileFields value={applicationDetails} onChange={setApplicationDetails} />

        {/* Education */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Education</h2>
          <textarea aria-label="Education" maxLength={5000} style={{ ...inputStyle, height: '100px', resize: 'vertical' }} value={education} onChange={e => setEducation(e.target.value)}
            placeholder="e.g. Bachelor of Computing, National University of Singapore (2025)" />
        </div>

        {/* Experience */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Experience</h2>
          <textarea aria-label="Experience" maxLength={10000} style={{ ...inputStyle, height: '140px', resize: 'vertical' }} value={experience} onChange={e => setExperience(e.target.value)}
            placeholder="e.g. Software Engineer Intern @ Company (Jun–Aug 2025): built ..." />
        </div>

        {/* Skills */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Skills</h2>
          <p>List skills you actually use, or add a short description (up to 100 characters each). Save before requesting job recommendations. Learning goals alone do not count as mastered skills.</p>
          <SkillSelector selected={skills} onChange={value => { setSkills(value); setSaved(false) }} />
        </div>

        {/* Links */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Links</h2>
          {links.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input aria-label={`Link ${i + 1} label`} maxLength={50} style={{ ...inputStyle, minWidth: 0, marginBottom: 0, flex: 1 }} placeholder="Label (e.g. LinkedIn)" value={l.label} onChange={e => setLink(i, { label: e.target.value })} />
              <input aria-label={`Link ${i + 1} URL`} maxLength={2000} style={{ ...inputStyle, minWidth: 0, marginBottom: 0, flex: 2 }} placeholder="https://..." value={l.url} onChange={e => setLink(i, { url: e.target.value })} />
              <button type="button" aria-label={`Remove link ${i + 1}`} onClick={() => { setLinks(prev => prev.filter((_, idx) => idx !== i)); setSaved(false) }} style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>×</button>
            </div>
          ))}
          <button type="button" disabled={links.length >= 30} onClick={() => { setLinks(prev => [...prev, { label: '', url: '' }]); setSaved(false) }}
            style={{ padding: '6px 16px', border: '1px dashed #1a73e8', color: '#1a73e8', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
            + Add Link
          </button>
        </div>

        {/* Save */}
        <div style={{ ...sectionStyle, textAlign: 'center' }}>
          <button type="submit" disabled={saving || loadFailed}
            style={{ padding: '12px 48px', fontSize: '15px', fontWeight: '500', color: 'white', border: 'none', borderRadius: '4px',
              backgroundColor: saving ? '#ccc' : '#1a73e8', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
          {saved && <p role="status" style={{ color: '#26713c', margin: '8px 0 0 0' }}>Profile saved. Your application details will be reused when you read the next application form. <Link to="/jobs">Find jobs for me</Link></p>}
          {error && !loadFailed && <p role="alert" style={{ color: '#dc2626', margin: '8px 0 0 0' }}>{error}</p>}
        </div>

        </fieldset>
        </form>

      </div>
    </div>
  )
}

export default ProfilePage
