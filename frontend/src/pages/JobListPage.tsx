import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { removeToken } from '../services/auth'

const MOCK_JOBS = [
  { id: 1, title: 'Software Engineer Intern', company: 'GovTech Singapore', location: 'Singapore', type: 'Internship', deadline: '2026-10-15', salary: '$1200/month' },
  { id: 2, title: 'Data Analyst Intern', company: 'DBS Bank', location: 'Singapore', type: 'Internship', deadline: '2026-10-20', salary: '$1000/month' },
  { id: 3, title: 'Frontend Developer', company: 'Shopee', location: 'Singapore', type: 'Full-time', deadline: '2026-11-01', salary: '$4000/month' },
  { id: 4, title: 'Product Manager Intern', company: 'Sea Limited', location: 'Singapore', type: 'Internship', deadline: '2026-10-30', salary: '$1500/month' },
  { id: 5, title: 'Business Analyst', company: 'OCBC Bank', location: 'Singapore', type: 'Full-time', deadline: '2026-11-15', salary: '$3500/month' },
]

const JobListPage = () => {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const navigate = useNavigate()

  const handleLogout = () => {
    removeToken()
    navigate('/')
  }

  const filtered = MOCK_JOBS.filter(job => {
    const matchSearch = job.title.toLowerCase().includes(search.toLowerCase()) ||
      job.company.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'All' || job.type === filter
    return matchSearch && matchFilter
  })

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Navbar */}
      <div style={{ backgroundColor: '#1a73e8', padding: '16px 32px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: 'white', margin: 0, fontSize: '20px' }}>JobPilot SG</h1>
        <button onClick={handleLogout}
          style={{ backgroundColor: 'transparent', color: 'white',
            border: '1px solid white', borderRadius: '4px',
            padding: '6px 16px', cursor: 'pointer' }}>
          Logout
        </button>
      </div>

      {/* Search & Filter */}
      <div style={{ padding: '24px 32px' }}>
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <input
            placeholder="Search jobs or companies..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, padding: '10px', border: '1px solid #ddd',
              borderRadius: '4px', fontSize: '14px' }}
          />
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '10px', border: '1px solid #ddd',
              borderRadius: '4px', fontSize: '14px' }}>
            <option value="All">All Types</option>
            <option value="Internship">Internship</option>
            <option value="Full-time">Full-time</option>
          </select>
        </div>

        {/* Job Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map(job => (
            <div key={job.id} style={{ backgroundColor: 'white', padding: '20px',
              borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              cursor: 'pointer' }}
              onClick={() => navigate(`/jobs/${job.id}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0' }}>{job.title}</h3>
                  <p style={{ margin: '0 0 8px 0', color: '#666' }}>{job.company} · {job.location}</p>
                  <span style={{ backgroundColor: '#e8f0fe', color: '#1a73e8',
                    padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>
                    {job.type}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: '#1a73e8' }}>
                    {job.salary}
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
                    Deadline: {job.deadline}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p style={{ textAlign: 'center', color: '#999' }}>No jobs found.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default JobListPage