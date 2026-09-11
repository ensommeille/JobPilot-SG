import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'

const MOCK_FAVORITES = [
  { id: 1, title: 'Software Engineer Intern', company: 'GovTech Singapore', location: 'Singapore', type: 'Internship', deadline: '2026-10-15', salary: '$1200/month' },
  { id: 3, title: 'Frontend Developer', company: 'Shopee', location: 'Singapore', type: 'Full-time', deadline: '2026-11-01', salary: '$4000/month' },
]

const FavoritesPage = () => {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <h2 style={{ marginBottom: '20px' }}>Saved Jobs</h2>

        {MOCK_FAVORITES.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', backgroundColor: 'white', borderRadius: '8px' }}>
            <p style={{ fontSize: '48px', margin: '0 0 16px 0' }}>☆</p>
            <p style={{ color: '#666' }}>No saved jobs yet. Browse jobs and click Save to add them here.</p>
            <button onClick={() => navigate('/jobs')}
              style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Browse Jobs
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {MOCK_FAVORITES.map(job => (
              <div key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
                style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0' }}>{job.title}</h3>
                  <p style={{ margin: '0 0 8px 0', color: '#666' }}>{job.company} · {job.location}</p>
                  <span style={{ backgroundColor: '#e8f0fe', color: '#1a73e8', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{job.type}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: '#1a73e8' }}>{job.salary}</p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#999' }}>Deadline: {job.deadline}</p>
                  <button onClick={e => { e.stopPropagation() }}
                    style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', color: '#f59e0b', fontSize: '13px' }}>
                    ★ Saved
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default FavoritesPage