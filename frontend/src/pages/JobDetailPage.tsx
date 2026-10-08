import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { fetchJobById, addFavorite, removeFavorite, formatSalary } from '../services/jobs'

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
  description?: string
  requirements?: string[]
  source_url: string | null
  source: { name: string }
  tags: { id: string; name: string }[]
}

const JobDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isFavorited, setIsFavorited] = useState(false)
  const [favLoading, setFavLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetchJobById(String(id))
        setJob(res.data)
        setIsFavorited(res.data.is_favorited ?? false)
      } catch {
        setError('Job not found or failed to load.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const toggleFavorite = async () => {
    if (!job || favLoading) return
    setFavLoading(true)
    try {
      if (isFavorited) {
        await removeFavorite(job.id)
        setIsFavorited(false)
      } else {
        await addFavorite(job.id)
        setIsFavorited(true)
      }
    } catch {
      // 静默失败
    } finally {
      setFavLoading(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo="/jobs" backLabel="← Back to Jobs" />
      <p style={{ textAlign: 'center', marginTop: '80px', color: '#666' }}>Loading...</p>
    </div>
  )

  if (error || !job) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo="/jobs" backLabel="← Back to Jobs" />
      <div style={{ textAlign: 'center', marginTop: '80px' }}>
        <p style={{ color: '#dc2626' }}>{error || 'Job not found'}</p>
        <button onClick={() => navigate('/jobs')}
          style={{ marginTop: '16px', padding: '10px 24px', backgroundColor: '#1a73e8',
            color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Back to Jobs
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      <Navbar backTo="/jobs" backLabel="← Back to Jobs" />
      <div style={{ maxWidth: '800px', margin: '32px auto', padding: '0 24px' }}>
        <div style={{ backgroundColor: 'white', borderRadius: '8px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)', padding: '32px' }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <h2 style={{ margin: '0 0 8px 0' }}>{job.title}</h2>
              <p style={{ margin: '0 0 8px 0', color: '#666', fontSize: '16px' }}>
                {job.company} · {job.city ?? 'Location not specified'}
              </p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ backgroundColor: '#e8f0fe', color: '#1a73e8',
                  padding: '4px 12px', borderRadius: '12px', fontSize: '13px' }}>{job.job_type}</span>
                {(job.tags ?? []).map(t => (
                  <span key={t.id} style={{ backgroundColor: '#f1f3f4', color: '#666',
                    padding: '4px 12px', borderRadius: '12px', fontSize: '13px' }}>{t.name}</span>
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {formatSalary(job) && (
                <p style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 'bold', color: '#1a73e8' }}>
                  {formatSalary(job)}
                </p>
              )}
              <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#999' }}>
                Deadline: {job.deadline ?? 'Not specified'}
              </p>
              <button onClick={toggleFavorite} disabled={favLoading}
                style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer',
                  backgroundColor: isFavorited ? '#fef3c7' : 'white',
                  border: `1px solid ${isFavorited ? '#f59e0b' : '#ddd'}`,
                  color: isFavorited ? '#f59e0b' : '#666' }}>
                {isFavorited ? '★ Favorited' : '☆ Add to Favorites'}
              </button>
            </div>
          </div>

          {/* Description */}
          {job.description && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ marginBottom: '8px' }}>Job Description</h3>
              <p style={{ color: '#444', lineHeight: '1.6' }}>{job.description}</p>
            </div>
          )}

          {/* Requirements */}
          {job.requirements && job.requirements.length > 0 && (
            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ marginBottom: '8px' }}>Requirements</h3>
              <ul style={{ color: '#444', lineHeight: '2' }}>
                {job.requirements.map((req, i) => <li key={i}>{req}</li>)}
              </ul>
            </div>
          )}

          {/* Source */}
          {job.source && (
            <p style={{ fontSize: '12px', color: '#999', marginBottom: '16px' }}>
              Source: {job.source.name}
            </p>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px' }}>
            {job.source_url && (
              <a href={job.source_url} target="_blank" rel="noopener noreferrer"
                style={{ padding: '10px 24px', backgroundColor: 'white',
                  border: '1px solid #1a73e8', color: '#1a73e8',
                  borderRadius: '4px', textDecoration: 'none', fontSize: '14px' }}>
                View Original Posting ↗
              </a>
            )}
            <button onClick={() => navigate(`/jobs/${job.id}/apply`)}
              style={{ padding: '10px 24px', backgroundColor: '#1a73e8',
                color: 'white', border: 'none', borderRadius: '4px',
                cursor: 'pointer', fontSize: '14px' }}>
              Apply with AI Assistant
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default JobDetailPage
