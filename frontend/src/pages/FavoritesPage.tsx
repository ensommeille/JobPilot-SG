import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchFavorites, removeFavorite, normalizeJobList } from '../services/jobs'
import type { JobView } from '../services/jobs'

const FavoritesPage = () => {
  const [favorites, setFavorites] = useState<JobView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetchFavorites()
        setFavorites(normalizeJobList(res.data))
      } catch {
        setError('Failed to load favorites.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleRemove = async (e: React.MouseEvent, id: string | number) => {
    e.stopPropagation()
    try {
      await removeFavorite(id)
      setFavorites(prev => prev.filter(j => j.id !== id))
    } catch {
      // 静默失败
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <h2 style={{ marginBottom: '20px' }}>Saved Jobs</h2>

        {loading && <p style={{ textAlign: 'center', color: '#666' }}>Loading...</p>}
        {error && <p style={{ textAlign: 'center', color: '#dc2626' }}>{error}</p>}

        {!loading && !error && favorites.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', backgroundColor: 'white', borderRadius: '8px' }}>
            <p style={{ fontSize: '48px', margin: '0 0 16px 0' }}>☆</p>
            <p style={{ color: '#666' }}>No saved jobs yet.</p>
            <button onClick={() => navigate('/jobs')}
              style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8',
                color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Browse Jobs
            </button>
          </div>
        )}

        {!loading && !error && favorites.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {favorites.map(job => (
              <div key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
                style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.1)', cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0' }}>{job.title}</h3>
                  <p style={{ margin: '0 0 8px 0', color: '#666' }}>{job.company} · {job.location}</p>
                  <span style={{ backgroundColor: '#e8f0fe', color: '#1a73e8',
                    padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{job.type}</span>
                </div>
                <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                  {job.salaryText && (
                    <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', color: '#1a73e8' }}>{job.salaryText}</p>
                  )}
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#999' }}>
                    Deadline: {job.deadline ?? 'N/A'}
                  </p>
                  <button onClick={e => handleRemove(e, job.id)}
                    style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b',
                      borderRadius: '4px', padding: '4px 12px', cursor: 'pointer',
                      color: '#f59e0b', fontSize: '13px' }}>
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
