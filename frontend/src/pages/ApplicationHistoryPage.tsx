import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchApplications } from '../services/applications'

interface Application {
  id: number
  job_id: number
  job_title: string
  company: string
  applied_at: string
  status: string
}

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  'draft':        { color: '#6b7280', bg: '#f3f4f6' },
  'submitted':    { color: '#1a73e8', bg: '#e8f0fe' },
  'under_review': { color: '#f59e0b', bg: '#fffbeb' },
  'interview':    { color: '#9333ea', bg: '#f3e8ff' },
  'offered':      { color: '#34a853', bg: '#f0fdf4' },
  'rejected':     { color: '#dc2626', bg: '#fef2f2' },
}

const STATUS_LABEL: Record<string, string> = {
  'draft':        'Draft',
  'submitted':    'Applied',
  'under_review': 'Under Review',
  'interview':    'Interview',
  'offered':      'Offered',
  'rejected':     'Rejected',
}

const ApplicationHistoryPage = () => {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetchApplications()
        setApplications(res.data?.items ?? res.data ?? [])
      } catch {
        setError('Failed to load applications.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <h2 style={{ marginBottom: '20px' }}>My Applications</h2>

        {loading && <p style={{ textAlign: 'center', color: '#666' }}>Loading...</p>}
        {error && <p style={{ textAlign: 'center', color: '#dc2626' }}>{error}</p>}

        {!loading && !error && applications.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', backgroundColor: 'white', borderRadius: '8px' }}>
            <p style={{ fontSize: '48px', margin: '0 0 16px 0' }}>📋</p>
            <p style={{ color: '#666' }}>No applications yet.</p>
            <button onClick={() => navigate('/jobs')}
              style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8',
                color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Browse Jobs
            </button>
          </div>
        )}

        {!loading && !error && applications.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {applications.map(app => {
              const status = STATUS_CONFIG[app.status] ?? STATUS_CONFIG['submitted']
              const label = STATUS_LABEL[app.status] ?? app.status
              return (
                <div key={app.id} style={{ backgroundColor: 'white', padding: '20px',
                  borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0' }}>{app.job_title}</h3>
                    <p style={{ margin: '0 0 4px 0', color: '#666' }}>{app.company}</p>
                    <p style={{ margin: 0, fontSize: '13px', color: '#999' }}>
                      Applied: {new Date(app.applied_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column',
                    alignItems: 'flex-end', gap: '8px' }}>
                    <span style={{ backgroundColor: status.bg, color: status.color,
                      padding: '4px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: '500' }}>
                      {label}
                    </span>
                    <button onClick={() => navigate(`/jobs/${app.job_id}`)}
                      style={{ fontSize: '13px', color: '#1a73e8', background: 'none',
                        border: 'none', cursor: 'pointer', padding: 0 }}>
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