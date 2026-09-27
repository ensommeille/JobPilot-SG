import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchJobs, addFavorite, removeFavorite, formatSalary } from '../services/jobs'

const CITIES = ['All Cities', 'Singapore', 'Remote']
const TYPES = ['All Types', 'Internship', 'Full-time']
const TAGS = ['All Tags', 'Tech', 'Finance', 'Data', 'Product', 'E-commerce', 'Banking', 'Government']
const DEADLINES = ['Any Deadline', 'Within 1 week', 'Within 2 weeks', 'Within 1 month']
const POSTED = ['Any Time', 'Today', 'Last 3 days', 'Last week']

interface Job {
  id: string
  title: string
  company: string
  city: string | null
  job_type: string | null
  deadline: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  salary_period: string | null
  tags: { id: string; name: string }[]
  posted_at?: string
}

const JobListPage = () => {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('All Cities')
  const [type, setType] = useState('All Types')
  const [tag, setTag] = useState('All Tags')
  const [deadline, setDeadline] = useState('Any Deadline')
  const [posted, setPosted] = useState('Any Time')
  const [favorites, setFavorites] = useState<string[]>([])
  const [now] = useState(() => Date.now())
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetchJobs({ q: search || undefined })
        setJobs(res.data?.items ?? res.data ?? [])
      } catch {
        setError('Failed to load jobs. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
  }, [search])

  const toggleFavorite = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      if (favorites.includes(id)) {
        await removeFavorite(id)
        setFavorites(prev => prev.filter(f => f !== id))
      } else {
        await addFavorite(id)
        setFavorites(prev => [...prev, id])
      }
    } catch {
      // 静默失败，不影响体验
    }
  }

  const filtered = jobs.filter(job => {
    const matchCity = city === 'All Cities' || job.city === city
    const matchType = type === 'All Types' || job.job_type?.toLowerCase() === type.toLowerCase()
    const matchTag = tag === 'All Tags' || (job.tags ?? []).some(item => item.name === tag)
    const matchDeadline = deadline === 'Any Deadline' ||
      (job.deadline !== null && (
        (deadline === 'Within 1 week' && new Date(job.deadline) <= new Date(now + 7 * 86400000)) ||
        (deadline === 'Within 2 weeks' && new Date(job.deadline) <= new Date(now + 14 * 86400000)) ||
        (deadline === 'Within 1 month' && new Date(job.deadline) <= new Date(now + 30 * 86400000))
      ))
    return matchCity && matchType && matchTag && matchDeadline
  })

  const selectStyle = {
    padding: '8px 12px', border: '1px solid #ddd',
    borderRadius: '4px', fontSize: '14px', backgroundColor: 'white', cursor: 'pointer'
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ padding: '24px 32px' }}>
        <input placeholder="Search jobs or companies..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '10px 16px', border: '1px solid #ddd',
            borderRadius: '4px', fontSize: '14px', marginBottom: '12px', boxSizing: 'border-box' }} />

        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <select value={city} onChange={e => setCity(e.target.value)} style={selectStyle}>
            {CITIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)} style={selectStyle}>
            {TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          <select value={tag} onChange={e => setTag(e.target.value)} style={selectStyle}>
            {TAGS.map(t => <option key={t}>{t}</option>)}
          </select>
          <select value={deadline} onChange={e => setDeadline(e.target.value)} style={selectStyle}>
            {DEADLINES.map(d => <option key={d}>{d}</option>)}
          </select>
          <select value={posted} onChange={e => setPosted(e.target.value)} style={selectStyle}>
            {POSTED.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>

        {loading && <p style={{ textAlign: 'center', color: '#666' }}>Loading jobs...</p>}
        {error && <p style={{ textAlign: 'center', color: '#dc2626' }}>{error}</p>}

        {!loading && !error && (
          <>
            <p style={{ color: '#666', marginBottom: '12px', fontSize: '14px' }}>
              {filtered.length} job{filtered.length !== 1 ? 's' : ''} found
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filtered.map(job => (
                <div key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
                  style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.1)', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: '0 0 4px 0' }}>{job.title}</h3>
                      <p style={{ margin: '0 0 8px 0', color: '#666' }}>{job.company} · {job.city ?? 'Location not specified'}</p>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ backgroundColor: '#e8f0fe', color: '#1a73e8',
                          padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{job.job_type}</span>
                        {(job.tags ?? []).map(t => (
                          <span key={t.id} style={{ backgroundColor: '#f1f3f4', color: '#666',
                            padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{t.name}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                      {formatSalary(job) && (
                        <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: '#1a73e8' }}>{formatSalary(job)}</p>
                      )}
                      <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#999' }}>
                        Deadline: {job.deadline ?? 'Not specified'}
                      </p>
                      <button onClick={e => toggleFavorite(e, job.id)}
                        style={{ backgroundColor: favorites.includes(job.id) ? '#fef3c7' : 'white',
                          border: `1px solid ${favorites.includes(job.id) ? '#f59e0b' : '#ddd'}`,
                          borderRadius: '4px', padding: '4px 12px', cursor: 'pointer',
                          color: favorites.includes(job.id) ? '#f59e0b' : '#666', fontSize: '13px' }}>
                        {favorites.includes(job.id) ? '★ Saved' : '☆ Save'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filtered.length === 0 && (
                <p style={{ textAlign: 'center', color: '#999', padding: '40px' }}>
                  No jobs found. Try adjusting your filters.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default JobListPage
