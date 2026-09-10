import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'

const MOCK_APPLICATIONS = [
  { id: 1, jobId: 1, title: 'Software Engineer Intern', company: 'GovTech Singapore', appliedDate: '2026-09-10', status: 'Under Review' },
  { id: 2, jobId: 2, title: 'Data Analyst Intern', company: 'DBS Bank', appliedDate: '2026-09-08', status: 'Applied' },
  { id: 3, jobId: 3, title: 'Frontend Developer', company: 'Shopee', appliedDate: '2026-09-05', status: 'Interview' },
]

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  'Applied':       { color: '#1a73e8', bg: '#e8f0fe' },
  'Under Review':  { color: '#f59e0b', bg: '#fffbeb' },
  'Interview':     { color: '#9333ea', bg: '#f3e8ff' },
  'Offered':       { color: '#34a853', bg: '#f0fdf4' },
  'Rejected':      { color: '#dc2626', bg: '#fef2f2' },
}

const ApplicationHistoryPage = () => {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <h2 style={{ marginBottom: '20px' }}>My Applications</h2>

        {MOCK_APPLICATIONS.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', backgroundColor: 'white', borderRadius: '8px' }}>
            <p style={{ fontSize: '48px', margin: '0 0 16px 0' }}>📋</p>
            <p style={{ color: '#666' }}>No applications yet. Find a job and apply with AI Assistant!</p>
            <button onClick={() => navigate('/jobs')}
              style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Browse Jobs
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {MOCK_APPLICATIONS.map(app => {
              const status = STATUS_CONFIG[app.status] || STATUS_CONFIG['Applied']
              return (
                <div key={app.id}
                  style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0' }}>{app.title}</h3>
                    <p style={{ margin: '0 0 8px 0', color: '#666' }}>{app.company}</p>
                    <p style={{ margin: 0, fontSize: '13px', color: '#999' }}>Applied: {app.appliedDate}</p>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                    <span style={{ backgroundColor: status.bg, color: status.color, padding: '4px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: '500' }}>
                      {app.status}
                    </span>
                    <button onClick={() => navigate(`/jobs/${app.jobId}`)}
                      style={{ fontSize: '13px', color: '#1a73e8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      View Job →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default ApplicationHistoryPage