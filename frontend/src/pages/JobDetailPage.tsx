import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import Navbar from '../components/Navbar'

const MOCK_JOBS = [
  {
    id: 1, title: 'Software Engineer Intern', company: 'GovTech Singapore',
    location: 'Singapore', type: 'Internship', deadline: '2026-10-15',
    salary: '$1200/month', description: 'Join GovTech to build digital services for Singapore citizens. You will work on web applications using React and Node.js.',
    requirements: ['Pursuing a degree in Computer Science or related field', 'Knowledge of JavaScript/TypeScript', 'Familiarity with React', 'Good communication skills'],
    url: 'https://www.tech.gov.sg/careers'
  },
  {
    id: 2, title: 'Data Analyst Intern', company: 'DBS Bank',
    location: 'Singapore', type: 'Internship', deadline: '2026-10-20',
    salary: '$1000/month', description: 'Work with DBS data teams to analyze customer behavior and support business decisions through data-driven insights.',
    requirements: ['Pursuing degree in Data Science, Statistics or related', 'Proficient in Python or R', 'Experience with SQL', 'Strong analytical mindset'],
    url: 'https://www.dbs.com/careers'
  },
  {
    id: 3, title: 'Frontend Developer', company: 'Shopee',
    location: 'Singapore', type: 'Full-time', deadline: '2026-11-01',
    salary: '$4000/month', description: 'Build and maintain high-performance web applications for millions of users across Southeast Asia.',
    requirements: ['3+ years of frontend experience', 'Expert in React and TypeScript', 'Experience with performance optimization', 'Strong eye for UI/UX'],
    url: 'https://careers.shopee.sg'
  },
  {
    id: 4, title: 'Product Manager Intern', company: 'Sea Limited',
    location: 'Singapore', type: 'Internship', deadline: '2026-10-30',
    salary: '$1500/month', description: 'Work closely with engineering and design teams to define product roadmaps and deliver user-centric features.',
    requirements: ['Strong analytical and problem-solving skills', 'Excellent communication', 'Passion for technology products', 'Prior PM or startup experience a plus'],
    url: 'https://www.sea.com/careers'
  },
  {
    id: 5, title: 'Business Analyst', company: 'OCBC Bank',
    location: 'Singapore', type: 'Full-time', deadline: '2026-11-15',
    salary: '$3500/month', description: 'Bridge business and technology by analyzing processes, gathering requirements, and supporting digital transformation initiatives.',
    requirements: ['Degree in Business, Finance or IT', '1-2 years relevant experience', 'Strong Excel and data skills', 'Banking domain knowledge preferred'],
    url: 'https://www.ocbc.com/careers'
  },
]

const JobDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [isFavorited, setIsFavorited] = useState(false)

  const job = MOCK_JOBS.find(j => j.id === Number(id))

  if (!job) return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <h2>Job not found</h2>
      <button onClick={() => navigate('/jobs')}>Back to Jobs</button>
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
                {job.company} · {job.location}
              </p>
              <span style={{ backgroundColor: '#e8f0fe', color: '#1a73e8',
                padding: '4px 12px', borderRadius: '12px', fontSize: '13px' }}>
                {job.type}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 'bold', color: '#1a73e8' }}>
                {job.salary}
              </p>
              <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#999' }}>
                Deadline: {job.deadline}
              </p>
              <button onClick={() => setIsFavorited(!isFavorited)}
                style={{ padding: '6px 16px', borderRadius: '4px', cursor: 'pointer',
                  backgroundColor: isFavorited ? '#fef3c7' : 'white',
                  border: `1px solid ${isFavorited ? '#f59e0b' : '#ddd'}`,
                  color: isFavorited ? '#f59e0b' : '#666' }}>
                {isFavorited ? '★ Favorited' : '☆ Add to Favorites'}
              </button>
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ marginBottom: '8px' }}>Job Description</h3>
            <p style={{ color: '#444', lineHeight: '1.6' }}>{job.description}</p>
          </div>

          {/* Requirements */}
          <div style={{ marginBottom: '32px' }}>
            <h3 style={{ marginBottom: '8px' }}>Requirements</h3>
            <ul style={{ color: '#444', lineHeight: '2' }}>
              {job.requirements.map((req, i) => (
                <li key={i}>{req}</li>
              ))}
            </ul>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <a href={job.url} target="_blank" rel="noopener noreferrer"
              style={{ padding: '10px 24px', backgroundColor: 'white',
                border: '1px solid #1a73e8', color: '#1a73e8',
                borderRadius: '4px', textDecoration: 'none', fontSize: '14px' }}>
              View Original Posting ↗
            </a>
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