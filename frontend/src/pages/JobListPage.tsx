import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchJobs, addFavorite, removeFavorite } from '../services/jobs'

const CITIES = ['All Cities', 'Singapore', 'Remote']
const TYPES = ['All Types', 'Internship', 'Full-time']
const TAGS = ['All Tags', 'Tech', 'Finance', 'Data', 'Product', 'E-commerce', 'Banking', 'Government']
const DEADLINES = ['Any Deadline', 'Within 1 week', 'Within 2 weeks', 'Within 1 month']
const POSTED = ['Any Time', 'Today', 'Last 3 days', 'Last week']

interface Job {
  id: number
  title: string
  company: string
  location: string
  type: string
  deadline: string
  salary?: string
  tags: string[]
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
  const [favorites, setFavorites] = useState<number[]>([])
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

  const toggleFavorite = async (e: React.MouseEvent, id: number) => {
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
    const matchCity = city === 'All Cities' || job.location === city
    const matchType = type === 'All Types' || job.type === type
    const matchTag = tag === 'All Tags' || (job.tags ?? []).includes(tag)
    const matchDeadline = deadline === 'Any Deadline' ||
      (deadline === 'Within 1 week' && new Date(job.deadline) <= new Date(now + 7 * 86400000)) ||
      (deadline === 'Within 2 weeks' && new Date(job.deadline) <= new Date(now + 14 * 86400000)) ||
      (deadline === 'Within 1 month' && new Date(job.deadline) <= new Date(now + 30 * 86400000))
    return matchCity && matchType && matchTag && matchDeadline
  })

  const SearchIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  )

  // 截止日期在 7 天内的岗位高亮提醒
  const isClosingSoon = (d: string) => {
    const t = new Date(d).getTime()
    return t >= now && t <= now + 7 * 86400000
  }

  return (
    <div className="page">
      <Navbar />
      <div className="container">
        <div className="page-header">
          <h1>Discover jobs</h1>
          <p>Internships and graduate roles across Singapore, updated daily.</p>
        </div>

        <div className="card toolbar">
          <div className="search">
            {SearchIcon}
            <input className="input" placeholder="Search by job title or company…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="filters">
            <select className="select" value={city} onChange={e => setCity(e.target.value)}>
              {CITIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <select className="select" value={type} onChange={e => setType(e.target.value)}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select className="select" value={tag} onChange={e => setTag(e.target.value)}>
              {TAGS.map(t => <option key={t}>{t}</option>)}
            </select>
            <select className="select" value={deadline} onChange={e => setDeadline(e.target.value)}>
              {DEADLINES.map(d => <option key={d}>{d}</option>)}
            </select>
            <select className="select" value={posted} onChange={e => setPosted(e.target.value)}>
              {POSTED.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {loading && <p className="empty">Loading jobs…</p>}
        {error && <div className="alert alert-error">{error}</div>}

        {!loading && !error && (
          <>
            <p className="subtle" style={{ marginBottom: 'var(--s-3)' }}>
              {filtered.length} job{filtered.length !== 1 ? 's' : ''} found
            </p>
            <div className="stack">
              {filtered.map(job => {
                const saved = favorites.includes(job.id)
                return (
                  <article key={job.id} className="card card-clickable job-card"
                    onClick={() => navigate(`/jobs/${job.id}`)}>
                    <div className="company-logo">{job.company?.charAt(0) ?? '?'}</div>

                    <div className="job-main">
                      <h3>{job.title}</h3>
                      <p className="job-meta">{job.company} · {job.location}</p>
                      <div className="job-tags">
                        <span className="tag tag-primary">{job.type}</span>
                        {(job.tags ?? []).map(t => <span key={t} className="tag">{t}</span>)}
                        {isClosingSoon(job.deadline) && <span className="tag tag-warning">Closing soon</span>}
                      </div>
                    </div>

                    <div className="job-side">
                      {job.salary && <span className="salary">{job.salary}</span>}
                      <span className="subtle">Deadline {job.deadline}</span>
                      <button className={`btn btn-secondary btn-sm save-btn ${saved ? 'saved' : ''}`}
                        onClick={e => toggleFavorite(e, job.id)}>
                        {saved ? '★ Saved' : '☆ Save'}
                      </button>
                    </div>
                  </article>
                )
              })}
              {filtered.length === 0 && (
                <div className="card empty">
                  <h3>No jobs match your filters</h3>
                  <p style={{ marginTop: 'var(--s-1)' }}>Try a different keyword or clear some filters.</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default JobListPage