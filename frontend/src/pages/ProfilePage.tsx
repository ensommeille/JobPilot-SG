import { useState } from 'react'
import Navbar from '../components/Navbar'

// ============ 预设数据 ============
const SKILL_CATEGORIES: Record<string, string[]> = {
  'Programming Languages': ['Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'R', 'SQL', 'MATLAB', 'Go', 'Swift', 'Kotlin', 'PHP', 'Ruby', 'Scala', 'HTML/CSS', 'Bash/Shell'],
  'Frameworks & Libraries': ['React', 'Vue.js', 'Angular', 'Node.js', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'TensorFlow', 'PyTorch', 'Pandas', 'NumPy', 'scikit-learn', 'Express.js'],
  'Tools & Platforms': ['Git', 'Docker', 'Kubernetes', 'AWS', 'Microsoft Azure', 'Google Cloud', 'Linux', 'Jira', 'Confluence', 'Figma', 'Tableau', 'Power BI', 'Salesforce', 'Bloomberg Terminal', 'Postman'],
  'Data & Analytics': ['Data Analysis', 'Machine Learning', 'Deep Learning', 'NLP', 'Data Visualization', 'Statistical Analysis', 'ETL', 'A/B Testing', 'Business Intelligence'],
  'Finance & Business': ['Financial Modeling', 'Valuation', 'Risk Analysis', 'VBA/Macros', 'Financial Analysis', 'Investment Analysis', 'CRM', 'Excel (Advanced)', 'PowerPoint'],
  'Design': ['UI/UX Design', 'Adobe Photoshop', 'Adobe Illustrator', 'Figma', 'Wireframing', 'Prototyping'],
  'Soft Skills': ['Project Management', 'Agile/Scrum', 'Leadership', 'Communication', 'Critical Thinking', 'Problem Solving', 'Teamwork', 'Time Management'],
}

const ALL_LANGUAGES = [
  'English', 'Mandarin Chinese', 'Cantonese', 'Bahasa Malay', 'Tamil',
  'Hindi', 'French', 'German', 'Spanish', 'Japanese', 'Korean',
  'Portuguese', 'Arabic', 'Russian', 'Italian', 'Bahasa Indonesia',
  'Thai', 'Vietnamese', 'Tagalog', 'Bengali', 'Urdu', 'Other'
]
const LANGUAGE_LEVELS = ['Native', 'Fluent', 'Advanced', 'Intermediate', 'Basic']
const GENDER_OPTIONS = ['Prefer not to say', 'Female', 'Male', 'Non-binary', 'Other']
const WORK_AUTH_OPTIONS = ['Singapore Citizen', 'Singapore PR', 'Employment Pass', 'S Pass', 'Student Pass', 'Dependent Pass', 'Other']
const DEGREE_OPTIONS = ['Bachelor', 'Master', 'PhD', 'Diploma', 'Associate', 'Certificate', 'Other']
const YEAR_OPTIONS = Array.from({ length: 15 }, (_, i) => String(2020 + i))

// ============ 接口类型 ============
interface Education { id: number; school: string; degree: string; major: string; graduationYear: string; gpa: string }
interface Experience { id: number; company: string; position: string; startDate: string; endDate: string; isCurrent: boolean; description: string }
interface Project { id: number; name: string; role: string; startDate: string; endDate: string; isCurrent: boolean; description: string; url: string }
interface Language { id: number; language: string; level: string }
interface Certification { id: number; name: string; issuer: string; issueDate: string; expiryDate: string; credentialId: string }

// ============ 样式常量 ============
const sectionStyle = { backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', padding: '24px', marginBottom: '16px' }
const inputStyle = { width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px', boxSizing: 'border-box' as const, marginBottom: '8px' }
const labelStyle = { fontSize: '13px', color: '#666', marginBottom: '4px', display: 'block' as const }

// ============ 区块头部组件 ============
const SectionHeader = ({ title, editing, onEdit, onCancel, onSave }: {
  title: string; editing: boolean; onEdit: () => void; onCancel: () => void; onSave: () => void
}) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
    <h2 style={{ margin: 0 }}>{title}</h2>
    {!editing
      ? <button onClick={onEdit} style={{ padding: '6px 16px', border: '1px solid #1a73e8', color: '#1a73e8', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer' }}>Edit</button>
      : <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onCancel} style={{ padding: '6px 16px', border: '1px solid #ddd', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
          <button onClick={onSave} style={{ padding: '6px 16px', backgroundColor: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save</button>
        </div>
    }
  </div>
)

// ============ Skills 选择器组件 ============
const SkillSelector = ({ selected, onChange }: { selected: string[], onChange: (s: string[]) => void }) => {
  const [search, setSearch] = useState('')
  const [customSkill, setCustomSkill] = useState('')
  const [openCat, setOpenCat] = useState<string | null>(null)

  const toggle = (skill: string) =>
    onChange(selected.includes(skill) ? selected.filter(s => s !== skill) : [...selected, skill])

  const addCustom = () => {
    const s = customSkill.trim()
    if (s && !selected.includes(s)) onChange([...selected, s])
    setCustomSkill('')
  }

  return (
    <div>
      {/* 已选技能 */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
          {selected.map(s => (
            <span key={s} style={{ backgroundColor: '#e8f0fe', color: '#1a73e8', padding: '4px 12px', borderRadius: '16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {s}
              <span onClick={() => toggle(s)} style={{ cursor: 'pointer', color: '#999', fontWeight: 'bold' }}>×</span>
            </span>
          ))}
        </div>
      )}

      {/* 搜索框 */}
      <input placeholder="🔍 Search skills..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ ...inputStyle, marginBottom: '8px' }} />

      {/* 分类展开 */}
      <div style={{ border: '1px solid #ddd', borderRadius: '4px', maxHeight: '260px', overflowY: 'auto' }}>
        {Object.entries(SKILL_CATEGORIES).map(([cat, skills]) => {
          const filtered = skills.filter(s => s.toLowerCase().includes(search.toLowerCase()))
          if (search && filtered.length === 0) return null
          return (
            <div key={cat}>
              <div onClick={() => setOpenCat(openCat === cat ? null : cat)}
                style={{ padding: '8px 12px', backgroundColor: '#f8f9fa', cursor: 'pointer', fontWeight: '500', fontSize: '13px', color: '#444', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', userSelect: 'none' as const }}>
                <span>{cat}</span>
                <span>{openCat === cat ? '▲' : '▼'}</span>
              </div>
              {(openCat === cat || search !== '') && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px 12px' }}>
                  {filtered.filter(s => !selected.includes(s)).map(skill => (
                    <span key={skill} onClick={() => toggle(skill)}
                      style={{ backgroundColor: '#f1f3f4', color: '#444', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', cursor: 'pointer', border: '1px solid #e0e0e0' }}>
                      + {skill}
                    </span>
                  ))}
                  {filtered.filter(s => !selected.includes(s)).length === 0 && (
                    <span style={{ fontSize: '12px', color: '#999' }}>All skills in this category already added</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 自定义技能 */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <input placeholder="Can't find it? Add custom skill (Enter)" value={customSkill}
          onChange={e => setCustomSkill(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addCustom() }}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }} />
        <button onClick={addCustom} style={{ padding: '8px 16px', backgroundColor: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Add</button>
      </div>
    </div>
  )
}

// ============ 主组件 ============
const ProfilePage = () => {
  // Personal
  const [personalEdit, setPersonalEdit] = useState(false)
  const [personal, setPersonal] = useState({ name: 'Tang Yuchen', email: 'yuchen.tang@example.com', phone: '+65 9897 7897', city: 'Singapore', address: '', dob: '', gender: 'Prefer not to say', linkedin: 'https://linkedin.com/in/yuchen-tang', photoName: '', resumeName: '' })
  const [personalDraft, setPersonalDraft] = useState({ ...personal })

  // About
  const [aboutEdit, setAboutEdit] = useState(false)
  const [about, setAbout] = useState('Motivated Information Management graduate with experience in finance and data analytics. Passionate about leveraging technology to solve real-world problems. Currently pursuing MSc in Software Engineering at NUS.')
  const [aboutDraft, setAboutDraft] = useState(about)

  // Auth
  const [authEdit, setAuthEdit] = useState(false)
  const [auth, setAuth] = useState({ nationality: 'Chinese', workAuth: 'Student Pass', availability: '2027-01', expectedSalary: '$1200-1500/month' })
  const [authDraft, setAuthDraft] = useState({ ...auth })

  // Education
  const [eduEdit, setEduEdit] = useState(false)
  const [educations, setEducations] = useState<Education[]>([
    { id: 1, school: 'National University of Singapore', degree: 'Master', major: 'Software Engineering', graduationYear: '2027', gpa: '' },
    { id: 2, school: 'Shenzhen University', degree: 'Bachelor', major: 'Information Management', graduationYear: '2025', gpa: '3.8' },
  ])
  const [eduDraft, setEduDraft] = useState<Education[]>([...educations])

  // Experience
  const [expEdit, setExpEdit] = useState(false)
  const [experiences, setExperiences] = useState<Experience[]>([
    { id: 1, company: 'CITIC Securities', position: 'Client Manager Intern', startDate: '2025-06', endDate: '2025-09', isCurrent: false, description: 'Online channel customer acquisition in Network Finance Division.' },
    { id: 2, company: 'Huatai Securities', position: 'Wealth Management Content Intern', startDate: '2024-06', endDate: '2024-09', isCurrent: false, description: 'Content operations for wealth management products.' },
  ])
  const [expDraft, setExpDraft] = useState<Experience[]>([...experiences])

  // Projects
  const [projEdit, setProjEdit] = useState(false)
  const [projects, setProjects] = useState<Project[]>([
    { id: 1, name: 'JobPilot SG', role: 'Frontend Developer', startDate: '2026-08', endDate: '', isCurrent: true, description: 'Full-stack job aggregation platform with AI-assisted application form assistant.', url: 'https://github.com/ensommeille/JobPilot-SG' },
  ])
  const [projDraft, setProjDraft] = useState<Project[]>([...projects])

  // Skills
  const [skillEdit, setSkillEdit] = useState(false)
  const [skills, setSkills] = useState(['Python', 'React', 'TypeScript', 'SQL', 'Excel (Advanced)', 'Data Analysis'])
  const [skillDraft, setSkillDraft] = useState([...skills])

  // Languages
  const [langEdit, setLangEdit] = useState(false)
  const [languages, setLanguages] = useState<Language[]>([
    { id: 1, language: 'Mandarin Chinese', level: 'Native' },
    { id: 2, language: 'English', level: 'Fluent' },
    { id: 3, language: 'French', level: 'Intermediate' },
  ])
  const [langDraft, setLangDraft] = useState<Language[]>([...languages])
  const [newLang, setNewLang] = useState({ language: 'English', level: 'Intermediate' })

  // Certifications
  const [certEdit, setCertEdit] = useState(false)
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [certDraft, setCertDraft] = useState<Certification[]>([])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>

        {/* Personal Info */}
        <div style={sectionStyle}>
          <SectionHeader title="Personal Information" editing={personalEdit}
            onEdit={() => { setPersonalDraft({ ...personal }); setPersonalEdit(true) }}
            onCancel={() => setPersonalEdit(false)}
            onSave={() => { setPersonal({ ...personalDraft }); setPersonalEdit(false) }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            <div style={{ width: '72px', height: '72px', borderRadius: '50%', backgroundColor: '#e8f0fe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 'bold', color: '#1a73e8' }}>
              {personal.name.charAt(0)}
            </div>
            <div>
              <p style={{ margin: '0 0 4px 0', fontWeight: '500', fontSize: '18px' }}>{personal.name}</p>
              {personalEdit && (
                <label style={{ fontSize: '13px', color: '#1a73e8', cursor: 'pointer' }}>
                  📷 Upload Photo
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setPersonalDraft(d => ({ ...d, photoName: e.target.files?.[0]?.name || '' }))} />
                </label>
              )}
            </div>
          </div>

          {personalEdit ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {[{ label: 'Full Name', key: 'name', type: 'text' }, { label: 'Email', key: 'email', type: 'email' }, { label: 'Phone', key: 'phone', type: 'tel' }, { label: 'City', key: 'city', type: 'text' }].map(({ label, key, type }) => (
                <div key={key}>
                  <label style={labelStyle}>{label}</label>
                  <input type={type} style={inputStyle} value={personalDraft[key as keyof typeof personalDraft]}
                    onChange={e => setPersonalDraft(d => ({ ...d, [key]: e.target.value }))} />
                </div>
              ))}
              <div>
                <label style={labelStyle}>Date of Birth</label>
                <input type="date" style={inputStyle} value={personalDraft.dob}
                  onChange={e => setPersonalDraft(d => ({ ...d, dob: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Gender</label>
                <select style={inputStyle} value={personalDraft.gender}
                  onChange={e => setPersonalDraft(d => ({ ...d, gender: e.target.value }))}>
                  {GENDER_OPTIONS.map(g => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Full Address (optional)</label>
                <input style={inputStyle} placeholder="e.g. 123 Clementi Ave 3, #04-05, Singapore 120123"
                  value={personalDraft.address} onChange={e => setPersonalDraft(d => ({ ...d, address: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>LinkedIn URL</label>
                <input style={inputStyle} value={personalDraft.linkedin}
                  onChange={e => setPersonalDraft(d => ({ ...d, linkedin: e.target.value }))} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Resume (PDF)</label>
                <label style={{ display: 'inline-block', padding: '8px 16px', border: '1px dashed #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', color: '#666' }}>
                  📄 {personalDraft.resumeName || 'Upload Resume PDF'}
                  <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setPersonalDraft(d => ({ ...d, resumeName: e.target.files?.[0]?.name || '' }))} />
                </label>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {[
                { label: 'Email', value: personal.email, full: false },
                { label: 'Phone', value: personal.phone, full: false },
                { label: 'City', value: personal.city, full: false },
                { label: 'Date of Birth', value: personal.dob || 'Not set', full: false },
                { label: 'Gender', value: personal.gender, full: false },
                { label: 'LinkedIn', value: personal.linkedin, full: true },
                { label: 'Full Address', value: personal.address || 'Not set', full: true },
                { label: 'Resume', value: personal.resumeName || 'Not uploaded', full: false },
              ].map(({ label, value, full }) => (
                <div key={label} style={{ gridColumn: full ? '1 / -1' : 'auto' }}>
                  <span style={{ fontSize: '12px', color: '#999' }}>{label}</span>
                  <p style={{ margin: '2px 0 0 0', fontSize: '14px' }}>{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* About Me */}
        <div style={sectionStyle}>
          <SectionHeader title="About Me" editing={aboutEdit}
            onEdit={() => { setAboutDraft(about); setAboutEdit(true) }}
            onCancel={() => setAboutEdit(false)}
            onSave={() => { setAbout(aboutDraft); setAboutEdit(false) }} />
          {aboutEdit
            ? <textarea style={{ ...inputStyle, height: '100px', resize: 'vertical' }} value={aboutDraft} onChange={e => setAboutDraft(e.target.value)} />
            : <p style={{ margin: 0, color: '#444', lineHeight: '1.6' }}>{about}</p>}
        </div>

        {/* Work Authorization */}
        <div style={sectionStyle}>
          <SectionHeader title="Work Authorization & Availability" editing={authEdit}
            onEdit={() => { setAuthDraft({ ...auth }); setAuthEdit(true) }}
            onCancel={() => setAuthEdit(false)}
            onSave={() => { setAuth({ ...authDraft }); setAuthEdit(false) }} />
          {authEdit ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Nationality</label>
                <input style={inputStyle} value={authDraft.nationality} onChange={e => setAuthDraft(d => ({ ...d, nationality: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Work Authorization in Singapore</label>
                <select style={inputStyle} value={authDraft.workAuth} onChange={e => setAuthDraft(d => ({ ...d, workAuth: e.target.value }))}>
                  {WORK_AUTH_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Earliest Start Date</label>
                <input type="month" style={inputStyle} value={authDraft.availability} onChange={e => setAuthDraft(d => ({ ...d, availability: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Expected Salary</label>
                <input style={inputStyle} placeholder="e.g. $1200-1500/month" value={authDraft.expectedSalary} onChange={e => setAuthDraft(d => ({ ...d, expectedSalary: e.target.value }))} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {[{ label: 'Nationality', value: auth.nationality }, { label: 'Work Authorization', value: auth.workAuth }, { label: 'Earliest Start Date', value: auth.availability }, { label: 'Expected Salary', value: auth.expectedSalary }].map(({ label, value }) => (
                <div key={label}>
                  <span style={{ fontSize: '12px', color: '#999' }}>{label}</span>
                  <p style={{ margin: '2px 0 0 0', fontSize: '14px' }}>{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Education */}
        <div style={sectionStyle}>
          <SectionHeader title="Education" editing={eduEdit}
            onEdit={() => { setEduDraft(educations.map(e => ({ ...e }))); setEduEdit(true) }}
            onCancel={() => setEduEdit(false)}
            onSave={() => { setEducations([...eduDraft]); setEduEdit(false) }} />
          {eduDraft.map((edu, i) => (
            <div key={edu.id} style={{ borderLeft: '3px solid #1a73e8', paddingLeft: '16px', marginBottom: '16px' }}>
              {eduEdit ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>School / University</label>
                    <input style={inputStyle} value={edu.school} onChange={e => { const u = [...eduDraft]; u[i] = { ...u[i], school: e.target.value }; setEduDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Degree</label>
                    <select style={inputStyle} value={edu.degree} onChange={e => { const u = [...eduDraft]; u[i] = { ...u[i], degree: e.target.value }; setEduDraft(u) }}>
                      {DEGREE_OPTIONS.map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Major / Field of Study</label>
                    <input style={inputStyle} value={edu.major} onChange={e => { const u = [...eduDraft]; u[i] = { ...u[i], major: e.target.value }; setEduDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Graduation Year</label>
                    <select style={inputStyle} value={edu.graduationYear} onChange={e => { const u = [...eduDraft]; u[i] = { ...u[i], graduationYear: e.target.value }; setEduDraft(u) }}>
                      {YEAR_OPTIONS.map(y => <option key={y}>{y}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>GPA (optional)</label>
                    <input style={inputStyle} placeholder="e.g. 3.8 / 4.0" value={edu.gpa} onChange={e => { const u = [...eduDraft]; u[i] = { ...u[i], gpa: e.target.value }; setEduDraft(u) }} />
                  </div>
                  <div style={{ gridColumn: '1 / -1', textAlign: 'right' }}>
                    <button onClick={() => setEduDraft(d => d.filter((_, idx) => idx !== i))} style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}>🗑 Remove</button>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600' }}>{edu.school}</p>
                  <p style={{ margin: '0 0 4px 0', color: '#444' }}>{edu.degree} in {edu.major}</p>
                  <p style={{ margin: 0, fontSize: '13px', color: '#999' }}>Class of {edu.graduationYear}{edu.gpa ? ` · GPA: ${edu.gpa}` : ''}</p>
                </>
              )}
            </div>
          ))}
          {eduEdit && (
            <button onClick={() => setEduDraft(d => [...d, { id: Date.now(), school: '', degree: 'Bachelor', major: '', graduationYear: '2027', gpa: '' }])}
              style={{ padding: '6px 16px', border: '1px dashed #1a73e8', color: '#1a73e8', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
              + Add Education
            </button>
          )}
        </div>

        {/* Experience */}
        <div style={sectionStyle}>
          <SectionHeader title="Work Experience" editing={expEdit}
            onEdit={() => { setExpDraft(experiences.map(e => ({ ...e }))); setExpEdit(true) }}
            onCancel={() => setExpEdit(false)}
            onSave={() => { setExperiences([...expDraft]); setExpEdit(false) }} />
          {expDraft.map((exp, i) => (
            <div key={exp.id} style={{ borderLeft: '3px solid #34a853', paddingLeft: '16px', marginBottom: '16px' }}>
              {expEdit ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={labelStyle}>Company</label>
                    <input style={inputStyle} value={exp.company} onChange={e => { const u = [...expDraft]; u[i] = { ...u[i], company: e.target.value }; setExpDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Position / Title</label>
                    <input style={inputStyle} value={exp.position} onChange={e => { const u = [...expDraft]; u[i] = { ...u[i], position: e.target.value }; setExpDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Start Date</label>
                    <input type="month" style={inputStyle} value={exp.startDate} onChange={e => { const u = [...expDraft]; u[i] = { ...u[i], startDate: e.target.value }; setExpDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>End Date</label>
                    {!exp.isCurrent && <input type="month" style={{ ...inputStyle, marginBottom: '4px' }} value={exp.endDate} onChange={e => { const u = [...expDraft]; u[i] = { ...u[i], endDate: e.target.value }; setExpDraft(u) }} />}
                    <label style={{ fontSize: '13px', color: '#666', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={exp.isCurrent} onChange={e => { const u = [...expDraft]; u[i] = { ...u[i], isCurrent: e.target.checked, endDate: '' }; setExpDraft(u) }} />
                      Currently working here
                    </label>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Description</label>
                    <textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} value={exp.description} onChange={e => { const u = [...expDraft]; u[i] = { ...u[i], description: e.target.value }; setExpDraft(u) }} />
                  </div>
                  <div style={{ gridColumn: '1 / -1', textAlign: 'right' }}>
                    <button onClick={() => setExpDraft(d => d.filter((_, idx) => idx !== i))} style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}>🗑 Remove</button>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600' }}>{exp.position}</p>
                  <p style={{ margin: '0 0 4px 0', color: '#444' }}>{exp.company}</p>
                  <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#999' }}>{exp.startDate} – {exp.isCurrent ? 'Present' : exp.endDate}</p>
                  <p style={{ margin: 0, fontSize: '14px', color: '#555' }}>{exp.description}</p>
                </>
              )}
            </div>
          ))}
          {expEdit && (
            <button onClick={() => setExpDraft(d => [...d, { id: Date.now(), company: '', position: '', startDate: '', endDate: '', isCurrent: false, description: '' }])}
              style={{ padding: '6px 16px', border: '1px dashed #34a853', color: '#34a853', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
              + Add Experience
            </button>
          )}
        </div>

        {/* Projects */}
        <div style={sectionStyle}>
          <SectionHeader title="Projects" editing={projEdit}
            onEdit={() => { setProjDraft(projects.map(p => ({ ...p }))); setProjEdit(true) }}
            onCancel={() => setProjEdit(false)}
            onSave={() => { setProjects([...projDraft]); setProjEdit(false) }} />
          {projDraft.map((proj, i) => (
            <div key={proj.id} style={{ borderLeft: '3px solid #9333ea', paddingLeft: '16px', marginBottom: '16px' }}>
              {projEdit ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={labelStyle}>Project Name</label>
                    <input style={inputStyle} value={proj.name} onChange={e => { const u = [...projDraft]; u[i] = { ...u[i], name: e.target.value }; setProjDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Your Role</label>
                    <input style={inputStyle} value={proj.role} onChange={e => { const u = [...projDraft]; u[i] = { ...u[i], role: e.target.value }; setProjDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Start Date</label>
                    <input type="month" style={inputStyle} value={proj.startDate} onChange={e => { const u = [...projDraft]; u[i] = { ...u[i], startDate: e.target.value }; setProjDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>End Date</label>
                    {!proj.isCurrent && <input type="month" style={{ ...inputStyle, marginBottom: '4px' }} value={proj.endDate} onChange={e => { const u = [...projDraft]; u[i] = { ...u[i], endDate: e.target.value }; setProjDraft(u) }} />}
                    <label style={{ fontSize: '13px', color: '#666', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={proj.isCurrent} onChange={e => { const u = [...projDraft]; u[i] = { ...u[i], isCurrent: e.target.checked, endDate: '' }; setProjDraft(u) }} />
                      Ongoing
                    </label>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Project URL (optional)</label>
                    <input style={inputStyle} value={proj.url} onChange={e => { const u = [...projDraft]; u[i] = { ...u[i], url: e.target.value }; setProjDraft(u) }} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Description</label>
                    <textarea style={{ ...inputStyle, height: '80px', resize: 'vertical' }} value={proj.description} onChange={e => { const u = [...projDraft]; u[i] = { ...u[i], description: e.target.value }; setProjDraft(u) }} />
                  </div>
                  <div style={{ gridColumn: '1 / -1', textAlign: 'right' }}>
                    <button onClick={() => setProjDraft(d => d.filter((_, idx) => idx !== i))} style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}>🗑 Remove</button>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600' }}>{proj.name}</p>
                  <p style={{ margin: '0 0 4px 0', color: '#444' }}>{proj.role}</p>
                  <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#999' }}>{proj.startDate} – {proj.isCurrent ? 'Present' : proj.endDate}</p>
                  <p style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#555' }}>{proj.description}</p>
                  {proj.url && <a href={proj.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#1a73e8' }}>{proj.url}</a>}
                </>
              )}
            </div>
          ))}
          {projEdit && (
            <button onClick={() => setProjDraft(d => [...d, { id: Date.now(), name: '', role: '', startDate: '', endDate: '', isCurrent: false, description: '', url: '' }])}
              style={{ padding: '6px 16px', border: '1px dashed #9333ea', color: '#9333ea', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
              + Add Project
            </button>
          )}
        </div>

        {/* Skills */}
        <div style={sectionStyle}>
          <SectionHeader title="Skills" editing={skillEdit}
            onEdit={() => { setSkillDraft([...skills]); setSkillEdit(true) }}
            onCancel={() => setSkillEdit(false)}
            onSave={() => { setSkills([...skillDraft]); setSkillEdit(false) }} />
          {skillEdit
            ? <SkillSelector selected={skillDraft} onChange={setSkillDraft} />
            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {skills.map(s => (
                  <span key={s} style={{ backgroundColor: '#e8f0fe', color: '#1a73e8', padding: '4px 12px', borderRadius: '16px', fontSize: '13px' }}>{s}</span>
                ))}
              </div>
          }
        </div>

        {/* Languages */}
        <div style={sectionStyle}>
          <SectionHeader title="Languages" editing={langEdit}
            onEdit={() => { setLangDraft(languages.map(l => ({ ...l }))); setLangEdit(true) }}
            onCancel={() => setLangEdit(false)}
            onSave={() => { setLanguages([...langDraft]); setLangEdit(false) }} />

          {langDraft.map((lang, i) => (
            <div key={lang.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              {langEdit ? (
                <>
                  <select style={{ ...inputStyle, marginBottom: 0, flex: 2 }} value={lang.language}
                    onChange={e => { const u = [...langDraft]; u[i] = { ...u[i], language: e.target.value }; setLangDraft(u) }}>
                    {ALL_LANGUAGES.map(l => <option key={l}>{l}</option>)}
                  </select>
                  <select style={{ ...inputStyle, marginBottom: 0, flex: 1 }} value={lang.level}
                    onChange={e => { const u = [...langDraft]; u[i] = { ...u[i], level: e.target.value }; setLangDraft(u) }}>
                    {LANGUAGE_LEVELS.map(l => <option key={l}>{l}</option>)}
                  </select>
                  <button onClick={() => setLangDraft(d => d.filter((_, idx) => idx !== i))}
                    style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>×</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: '14px', flex: 2 }}>{lang.language}</span>
                  <span style={{ backgroundColor: '#f1f3f4', color: '#666', padding: '2px 10px', borderRadius: '12px', fontSize: '12px' }}>{lang.level}</span>
                </>
              )}
            </div>
          ))}

          {langEdit && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #ddd' }}>
              <select style={{ ...inputStyle, marginBottom: 0, flex: 2 }} value={newLang.language}
                onChange={e => setNewLang(l => ({ ...l, language: e.target.value }))}>
                {ALL_LANGUAGES.filter(l => !langDraft.find(ld => ld.language === l)).map(l => <option key={l}>{l}</option>)}
              </select>
              <select style={{ ...inputStyle, marginBottom: 0, flex: 1 }} value={newLang.level}
                onChange={e => setNewLang(l => ({ ...l, level: e.target.value }))}>
                {LANGUAGE_LEVELS.map(l => <option key={l}>{l}</option>)}
              </select>
              <button onClick={() => {
                if (!langDraft.find(l => l.language === newLang.language)) {
                  setLangDraft(d => [...d, { id: Date.now(), ...newLang }])
                }
              }} style={{ padding: '8px 16px', backgroundColor: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap' as const }}>
                + Add
              </button>
            </div>
          )}
        </div>

        {/* Certifications */}
        <div style={sectionStyle}>
          <SectionHeader title="Certifications & Awards" editing={certEdit}
            onEdit={() => { setCertDraft(certifications.map(c => ({ ...c }))); setCertEdit(true) }}
            onCancel={() => setCertEdit(false)}
            onSave={() => { setCertifications([...certDraft]); setCertEdit(false) }} />

          {certDraft.length === 0 && !certEdit && (
            <p style={{ color: '#999', fontSize: '14px', margin: 0 }}>No certifications or awards added yet. Click Edit to add.</p>
          )}

          {certDraft.map((cert, i) => (
            <div key={cert.id} style={{ borderLeft: '3px solid #f59e0b', paddingLeft: '16px', marginBottom: '16px' }}>
              {certEdit ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>Certificate / Award Name</label>
                    <input style={inputStyle} placeholder="e.g. AWS Certified Solutions Architect, CFA Level 1" value={cert.name}
                      onChange={e => { const u = [...certDraft]; u[i] = { ...u[i], name: e.target.value }; setCertDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Issuing Organization</label>
                    <input style={inputStyle} placeholder="e.g. Amazon Web Services, CFA Institute" value={cert.issuer}
                      onChange={e => { const u = [...certDraft]; u[i] = { ...u[i], issuer: e.target.value }; setCertDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Credential ID (optional)</label>
                    <input style={inputStyle} value={cert.credentialId}
                      onChange={e => { const u = [...certDraft]; u[i] = { ...u[i], credentialId: e.target.value }; setCertDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Issue Date</label>
                    <input type="month" style={inputStyle} value={cert.issueDate}
                      onChange={e => { const u = [...certDraft]; u[i] = { ...u[i], issueDate: e.target.value }; setCertDraft(u) }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Expiry Date (optional)</label>
                    <input type="month" style={inputStyle} value={cert.expiryDate}
                      onChange={e => { const u = [...certDraft]; u[i] = { ...u[i], expiryDate: e.target.value }; setCertDraft(u) }} />
                  </div>
                  <div style={{ gridColumn: '1 / -1', textAlign: 'right' }}>
                    <button onClick={() => setCertDraft(d => d.filter((_, idx) => idx !== i))}
                      style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}>🗑 Remove</button>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600' }}>{cert.name}</p>
                  <p style={{ margin: '0 0 4px 0', color: '#444' }}>{cert.issuer}</p>
                  <p style={{ margin: 0, fontSize: '13px', color: '#999' }}>
                    Issued: {cert.issueDate}{cert.expiryDate ? ` · Expires: ${cert.expiryDate}` : ' · No Expiry'}{cert.credentialId ? ` · ID: ${cert.credentialId}` : ''}
                  </p>
                </>
              )}
            </div>
          ))}

          {certEdit && (
            <button onClick={() => setCertDraft(d => [...d, { id: Date.now(), name: '', issuer: '', issueDate: '', expiryDate: '', credentialId: '' }])}
              style={{ padding: '6px 16px', border: '1px dashed #f59e0b', color: '#f59e0b', backgroundColor: 'white', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>
              + Add Certification / Award
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

export default ProfilePage