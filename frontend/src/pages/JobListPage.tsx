import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchJobs, addFavorite, removeFavorite, normalizeJobList } from '../services/jobs'
import type { JobId, JobView } from '../services/jobs'

const DAY = 86400000
const PAGE_SIZE = 10

const DEADLINE_OPTIONS = [
  { value: 0, label: 'Any' },
  { value: 7, label: '1 week' },
  { value: 14, label: '2 weeks' },
  { value: 30, label: '1 month' },
]

const SORT_OPTIONS = [
  { value: 'deadline', label: 'Closing soon' },
  { value: 'newest', label: 'Newest' },
  { value: 'salary', label: 'Salary: high to low' },
] as const
type SortKey = (typeof SORT_OPTIONS)[number]['value']

// 公司头像配色：按公司名固定取一组，保证同一家公司颜色不变
const LOGO_COLORS = [
  ['#fde8e6', '#b0302a'], ['#e3f4e8', '#1d7a3e'], ['#e6eefc', '#2a52a8'],
  ['#fff0e3', '#a4520f'], ['#efe9fb', '#5b3aa8'], ['#e2f1ee', '#0f6e63'],
]
const logoColor = (name: string) => {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return LOGO_COLORS[h % LOGO_COLORS.length]
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
const daysUntil = (date: string, today: number) => Math.round((new Date(date + 'T00:00:00').getTime() - today) / DAY)

const deadlineInfo = (date: string | null, today: number) => {
  if (!date) return { text: 'No deadline', urgent: false }
  const d = daysUntil(date, today)
  if (d < 0) return { text: 'Closed', urgent: false }
  if (d === 0) return { text: 'Closes today', urgent: true }
  if (d <= 7) return { text: `Closes in ${d} day${d > 1 ? 's' : ''}`, urgent: true }
  return { text: `Closes ${new Date(date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`, urgent: false }
}

const postedText = (date: string | null, today: number) => {
  if (!date) return null
  const d = -daysUntil(date, today)
  if (d <= 0) return 'Posted today'
  if (d === 1) return 'Posted yesterday'
  if (d < 7) return `Posted ${d} days ago`
  return `Posted ${new Date(date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}`
}

// 统计每个选项出现的次数，用于侧栏显示数量
const countBy = (jobs: JobView[], pick: (j: JobView) => string[]) => {
  const m = new Map<string, number>()
  jobs.forEach(j => pick(j).forEach(v => m.set(v, (m.get(v) ?? 0) + 1)))
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
)
const PinIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" />
  </svg>
)
const ClockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
)
const BookmarkIcon = ({ filled }: { filled: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3h12v18l-6-4-6 4z" />
  </svg>
)
const XIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

const JobListPage = () => {
  const [jobs, setJobs] = useState<JobView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [favorites, setFavorites] = useState<JobId[]>([])
  const [today] = useState(startOfToday)
  const navigate = useNavigate()

  // 搜索 & 筛选
  const [search, setSearch] = useState('')
  const [place, setPlace] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const [deadlineDays, setDeadlineDays] = useState(0)
  const [salaryOnly, setSalaryOnly] = useState(false)
  const [sort, setSort] = useState<SortKey>('deadline')
  // 页码和当前筛选条件绑定：条件一变，自动回到第 1 页
  const [pageState, setPageState] = useState({ key: '', page: 1 })

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetchJobs({ q: search || undefined, page_size: 100 })
        setJobs(normalizeJobList(res.data))
      } catch {
        setError('Failed to load jobs. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    const timer = setTimeout(load, 300)
    return () => clearTimeout(timer)
  }, [search])

  const toggleFavorite = async (e: React.MouseEvent, id: JobId) => {
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

  const typeCounts = useMemo(() => countBy(jobs, j => [j.type]), [jobs])
  const tagCounts = useMemo(() => countBy(jobs, j => j.tags).slice(0, 8), [jobs])
  const locationCounts = useMemo(() => countBy(jobs, j => [j.location]), [jobs])

  const filtered = useMemo(() => {
    const placeQ = place.trim().toLowerCase()
    const list = jobs.filter(j => {
      if (types.length && !types.includes(j.type)) return false
      if (tags.length && !tags.some(t => j.tags.includes(t))) return false
      if (locations.length && !locations.includes(j.location)) return false
      if (placeQ && !j.location.toLowerCase().includes(placeQ)) return false
      if (salaryOnly && !j.salaryText) return false
      if (deadlineDays) {
        if (!j.deadline) return false
        const d = daysUntil(j.deadline, today)
        if (d < 0 || d > deadlineDays) return false
      }
      return true
    })
    const far = '9999-12-31'
    return [...list].sort((a, b) => {
      if (sort === 'newest') return (b.postedAt ?? '').localeCompare(a.postedAt ?? '')
      if (sort === 'salary') return (b.salaryValue ?? -1) - (a.salaryValue ?? -1)
      return (a.deadline ?? far).localeCompare(b.deadline ?? far)
    })
  }, [jobs, types, tags, locations, place, salaryOnly, deadlineDays, sort, today])

  const filterKey = JSON.stringify([search, place, types, tags, locations, salaryOnly, deadlineDays, sort])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = pageState.key === filterKey ? Math.min(pageState.page, pages) : 1
  const setPage = (next: number | ((p: number) => number)) =>
    setPageState({ key: filterKey, page: typeof next === 'function' ? next(page) : next })

  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const activeChips = [
    ...types.map(v => ({ label: v, remove: () => setTypes(p => p.filter(x => x !== v)) })),
    ...tags.map(v => ({ label: v, remove: () => setTags(p => p.filter(x => x !== v)) })),
    ...locations.map(v => ({ label: v, remove: () => setLocations(p => p.filter(x => x !== v)) })),
    ...(deadlineDays ? [{ label: `Closes within ${DEADLINE_OPTIONS.find(o => o.value === deadlineDays)?.label}`, remove: () => setDeadlineDays(0) }] : []),
    ...(salaryOnly ? [{ label: 'Has salary', remove: () => setSalaryOnly(false) }] : []),
  ]

  const clearAll = () => {
    setTypes([]); setTags([]); setLocations([]); setDeadlineDays(0); setSalaryOnly(false); setPlace('')
  }

  const filterGroups = [
    { name: 'Job type', options: typeCounts, selected: types, toggle: (v: string) => setTypes(p => toggleIn(p, v)) },
    { name: 'Category', options: tagCounts, selected: tags, toggle: (v: string) => setTags(p => toggleIn(p, v)) },
    { name: 'Location', options: locationCounts, selected: locations, toggle: (v: string) => setLocations(p => toggleIn(p, v)) },
  ].filter(g => g.options.length > 0)

  return (
    <div className="page">
      <Navbar />
      <main className="container">
        <div className="page-header">
          <h1>Discover jobs</h1>
          <p>Internships and graduate roles across Singapore, in one place.</p>
        </div>

        <form className="searchbar" onSubmit={e => e.preventDefault()} role="search">
          <label className="searchbar-field searchbar-main">
            <SearchIcon />
            <input type="search" placeholder="Job title, company or keyword" aria-label="Search jobs"
              value={search} onChange={e => setSearch(e.target.value)} />
          </label>
          <label className="searchbar-field searchbar-place">
            <PinIcon />
            <input placeholder="Anywhere in Singapore" aria-label="Location"
              value={place} onChange={e => setPlace(e.target.value)} />
          </label>
        </form>

        <div className="job-layout">
          <aside className="card filter-panel" aria-label="Filters">
            <div className="filter-head">
              <h2>Filters</h2>
              {activeChips.length > 0 && <button type="button" className="link" onClick={clearAll}>Clear all</button>}
            </div>

            {filterGroups.map(g => (
              <fieldset key={g.name} className="filter-group">
                <legend>{g.name}</legend>
                {g.options.map(([value, count]) => (
                  <label key={value} className="check-row">
                    <input type="checkbox" checked={g.selected.includes(value)} onChange={() => g.toggle(value)} />
                    <span className="check-label">{value}</span>
                    <span className="check-count">{count}</span>
                  </label>
                ))}
              </fieldset>
            ))}

            <fieldset className="filter-group">
              <legend>Deadline</legend>
              <div className="pill-row">
                {DEADLINE_OPTIONS.map(o => (
                  <button key={o.value} type="button" aria-pressed={deadlineDays === o.value}
                    className={`pill ${deadlineDays === o.value ? 'active' : ''}`}
                    onClick={() => setDeadlineDays(o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="switch-row">
              Only jobs with salary
              <input type="checkbox" checked={salaryOnly} onChange={e => setSalaryOnly(e.target.checked)} />
            </label>
          </aside>

          <section className="job-results">
            <div className="results-bar">
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <strong>{loading ? 'Loading…' : `${filtered.length} job${filtered.length !== 1 ? 's' : ''}`}</strong>
                {activeChips.map(c => (
                  <button key={c.label} type="button" className="chip-dark" onClick={c.remove} aria-label={`Remove filter ${c.label}`}>
                    {c.label} <XIcon />
                  </button>
                ))}
              </div>
              <label className="row muted" style={{ fontSize: 14 }}>
                Sort by
                <select className="select select-sm" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>

            {error && <div className="alert alert-error">{error}</div>}

            {!loading && !error && visible.map(job => {
              const saved = favorites.includes(job.id)
              const dl = deadlineInfo(job.deadline, today)
              const posted = postedText(job.postedAt, today)
              const [logoBg, logoFg] = logoColor(job.company)
              return (
                <article key={job.id} className="card card-clickable job-card" onClick={() => navigate(`/jobs/${job.id}`)}>
                  <div className="company-logo" style={{ background: logoBg, color: logoFg }}>
                    {job.company.charAt(0).toUpperCase()}
                  </div>

                  <div className="job-main">
                    <h3><a href={`/jobs/${job.id}`} onClick={e => { e.preventDefault() }}>{job.title}</a></h3>
                    <p className="job-meta">
                      {job.company} · {job.location}{posted && ` · ${posted}`}
                    </p>
                    <div className="job-tags">
                      <span className="tag tag-primary">{job.type}</span>
                      {job.tags.map(t => <span key={t} className="tag">{t}</span>)}
                      {job.source && <span className="tag tag-outline">via {job.source}</span>}
                    </div>
                  </div>

                  <div className="job-side">
                    <span className={job.salaryText ? 'salary' : 'subtle'}>{job.salaryText ?? 'Salary not disclosed'}</span>
                    <span className={`deadline-badge ${dl.urgent ? 'urgent' : ''}`}><ClockIcon />{dl.text}</span>
                    <button type="button" className={`icon-btn ${saved ? 'saved' : ''}`}
                      aria-label={saved ? 'Remove from saved' : 'Save job'} aria-pressed={saved}
                      onClick={e => toggleFavorite(e, job.id)}>
                      <BookmarkIcon filled={saved} />
                    </button>
                  </div>
                </article>
              )
            })}

            {!loading && !error && filtered.length === 0 && (
              <div className="card empty">
                <h3>No jobs match your filters</h3>
                <p style={{ marginTop: 'var(--s-1)' }}>Try a different keyword or remove a filter.</p>
                {activeChips.length > 0 && (
                  <button type="button" className="btn btn-secondary" style={{ marginTop: 'var(--s-4)' }} onClick={clearAll}>Clear all filters</button>
                )}
              </div>
            )}

            {!loading && !error && pages > 1 && (
              <nav className="pagination" aria-label="Pagination">
                <button type="button" className="btn btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
                {Array.from({ length: pages }, (_, i) => i + 1).map(n => (
                  <button key={n} type="button" aria-current={n === page ? 'page' : undefined}
                    className={`page-btn ${n === page ? 'active' : ''}`} onClick={() => setPage(n)}>{n}</button>
                ))}
                <button type="button" className="btn btn-secondary" disabled={page === pages} onClick={() => setPage(p => p + 1)}>Next</button>
              </nav>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

export default JobListPage
