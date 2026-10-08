import { useState, useEffect } from 'react'
import Navbar from '../components/Navbar'
import { fetchProfile, updateProfile } from '../services/profile'

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
  const toggle = (skill: string) => onChange(selected.includes(skill) ? selected.filter(s => s !== skill) : [...selected, skill])
  const addCustom = () => { const s = customSkill.trim(); if (s && !selected.includes(s)) onChange([...selected, s]); setCustomSkill('') }
  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {selected.map(s => (
            <span key={s} style={{ backgroundColor: '#e8f0fe', color: '#1a73e8', padding: '4px 12px', borderRadius: '16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {s}<span onClick={() => toggle(s)} style={{ cursor: 'pointer', color: '#999', fontWeight: 'bold' }}>×</span>
            </span>
          ))}
        </div>
      )}
      <input placeholder="🔍 Search skills..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, marginBottom: '8px' }} />
      <div style={{ border: '1px solid #ddd', borderRadius: '4px', maxHeight: '220px', overflowY: 'auto' }}>
        {Object.entries(SKILL_CATEGORIES).map(([cat, skills]) => {
          const filtered = skills.filter(s => s.toLowerCase().includes(search.toLowerCase()))
          if (search && filtered.length === 0) return null
          return (
            <div key={cat}>
              <div onClick={() => setOpenCat(openCat === cat ? null : cat)}
                style={{ padding: '8px 12px', backgroundColor: '#f8f9fa', cursor: 'pointer', fontWeight: '500', fontSize: '13px', color: '#444', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', userSelect: 'none' as const }}>
                <span>{cat}</span><span>{openCat === cat ? '▲' : '▼'}</span>
              </div>
              {(openCat === cat || search !== '') && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 12px' }}>
                  {filtered.filter(s => !selected.includes(s)).map(skill => (
                    <span key={skill} onClick={() => toggle(skill)}
                      style={{ backgroundColor: '#f1f3f4', color: '#444', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', cursor: 'pointer', border: '1px solid #e0e0e0' }}>
                      + {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <input placeholder="Add custom skill (Enter)" value={customSkill} onChange={e => setCustomSkill(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }} />
        <button onClick={addCustom} style={{ padding: '8px 16px', backgroundColor: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Add</button>
      </div>
    </div>
  )
}

interface LinkItem { label: string; url: string }

const ProfilePage = () => {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [education, setEducation] = useState('')
  const [experience, setExperience] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [links, setLinks] = useState<LinkItem[]>([])

  useEffect(() => {
    fetchProfile()
      .then(res => {
        const d = res.data
        setFullName(d.full_name ?? '')
        setPhone(d.phone ?? '')
        setContactEmail(d.contact_email ?? '')
        setEducation(d.education ?? '')
        setExperience(d.experience ?? '')
        setSkills(d.skills ?? [])
        setLinks(Object.entries(d.links ?? {}).map(([label, url]) => ({ label, url: String(url) })))
      })
      .catch(() => setError('Failed to load your profile.'))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      await updateProfile({
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        contact_email: contactEmail.trim() || null,
        education: education.trim() || null,
        experience: experience.trim() || null,
        skills,
        links: Object.fromEntries(links.filter(l => l.label.trim() && l.url.trim()).map(l => [l.label.trim(), l.url.trim()])),
      })
      setSaved(true)
    } catch {
      setError('Failed to save your profile.')
    } finally {
      setSaving(false)
    }
  }

  const setLink = (i: number, patch: Partial<LinkItem>) => {
    setLinks(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <p style={{ textAlign: 'center', marginTop: '80px', color: '#666' }}>Loading profile...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '720px', margin: '32px auto', padding: '0 24px' }}>

        {/* Personal */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Personal Information</h2>
          <div><label style={labelStyle}>Full Name</label><input style={inputStyle} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" /></div>
          <div><label style={labelStyle}>Contact Email</label><input type="email" style={inputStyle} value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></div>
          <div><label style={labelStyle}>Phone</label><input type="tel" style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+65 ..." /></div>
        </div>

        {/* Education */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Education</h2>
          <textarea style={{ ...inputStyle, height: '100px', resize: 'vertical' }} value={education} onChange={e => setEducation(e.target.value)}
            placeholder="e.g. Bachelor of Computing, National University of Singapore (2025)" />
        </div>

        {/* Experience */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Experience</h2>
          <textarea style={{ ...inputStyle, height: '140px', resize: 'vertical' }} value={experience} onChange={e => setExperience(e.target.value)}
            placeholder="e.g. Software Engineer Intern @ Company (Jun–Aug 2025): built ..." />
        </div>

        {/* Skills */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Skills</h2>
          <SkillSelector selected={skills} onChange={setSkills} />
        </div>

        {/* Links */}
        <div style={sectionStyle}>
          <h2 style={{ margin: '0 0 16px 0' }}>Links</h2>
          {links.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input style={{ ...inputStyle, marginBottom: 0, flex: 1 }} placeholder="Label (e.g. LinkedIn)" value={l.label} onChange={e => setLink(i, { label: e.target.value })} />
              <input style={{ ...inputStyle, marginBottom: 0, flex: 2 }} placeholder="https://..." value={l.url} onChange={e => setLink(i, { url: e.target.value })} />
              <button onClick={() => setLinks(prev => prev.filter((_, idx) => idx !== i))} style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>×</button>
            </div>
          ))}
          <button onClick={() => setLinks(prev => [...prev, { label: '', url: '' }])}
            style={{ padding: '6px 16px', border: '1px dashed #1a73e8', color: '#1a73e8', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
            + Add Link
          </button>
        </div>

        {/* Save */}
        <div style={{ ...sectionStyle, textAlign: 'center' }}>
          <button onClick={save} disabled={saving}
            style={{ padding: '12px 48px', fontSize: '15px', fontWeight: '500', color: 'white', border: 'none', borderRadius: '4px',
              backgroundColor: saving ? '#ccc' : '#1a73e8', cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
          {saved && <p style={{ color: '#34a853', margin: '8px 0 0 0' }}>✓ Profile saved.</p>}
          {error && <p role="alert" style={{ color: '#dc2626', margin: '8px 0 0 0' }}>{error}</p>}
        </div>

      </div>
    </div>
  )
}

export default ProfilePage
